# CI/CD de Player

## Référence

La structure reprend [celle du site Clyse](https://github.com/Clyse-Devs/clyse.dev/tree/dev/.github/workflows) : workflows réutilisables par étape, scans bloquants, artefacts et contrôle final `CI required`. Player utilise les runners GitHub Ubuntu 24.04, les runners de l’organisation Clyse ne sont pas partagés avec ce dépôt personnel.

Chaque push sur `developpment` ou `production`, tag `v*`, PR vers ces branches, lancement manuel et contrôle hebdomadaire exécute toute la pipeline. Les PR obsolètes sont annulées. Les exécutions de branche restent actives.

| Étape       | Contrôles                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lint        | Oxlint sur tout le code, format de l’outillage, TypeScript (front et `server/`), actionlint, ShellCheck (`scripts/ci`, `scripts/e2e`)                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Scan        | Trivy vulnérabilités HIGH/CRITICAL et licences, Gitleaks fichiers et historique complet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Build       | Build Vite et artefact `dist/` conservé 7 jours                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Test        | Tests Bun, tests Node du serveur (`yarn test:server`), Playwright sur le `dist/` récupéré (`PLAYER_SKIP_BUILD=1`) derrière le mock OIDC : montage, lecture partielle des médias authentifiée, connexion et déconnexion, parcours du panneau d'administration (`tests/e2e/admin.spec.ts` : import d'un WAV généré dans le test et rangement dans un nouveau dossier, renommage, suppression, accès refusé à un membre `users`). Le catalogue e2e vient de `tests/e2e/fixtures/` (deux WAV d'une seconde et un manifeste), importé par `scripts/e2e/start-server.sh` avant le démarrage du serveur |
| Deploy      | Hadolint, mock OIDC sur l'hôte, Compose avec `docker-compose.ci.yml` (variables OIDC de développement), image, healthcheck, puis `stack-check.sh` : `/healthz`, HTML, `/api/session` 401, `/api/auth/login` 302 vers le mock, 404 (dont `/Drops.mp3`, médias non publics), `/api/catalog` 401 sans session, uid 101, `/app` en lecture seule                                                                                                                                                                                                                                                     |
| CI required | Refuse tout échec, annulation ou contrôle ignoré                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Lint et scans démarrent ensemble. Build et validation Docker attendent le lint ; les tests attendent le build. Les rapports JUnit, traces Playwright et SBOM sont gardés 14 jours. Les sorties sont privées, rattachées au run GitHub.

Les actions sont épinglées par SHA, les images Docker par digest. Le token est limité à `contents: read` et n’est pas persisté dans le checkout. Aucun secret de production n’est utilisé. Les dépendances s’installent avec `--frozen-lockfile` et les versions de Node, Bun et Yarn sont fixées.

La mise en place corrige la prop `MotionConfig.features` incompatible et des symboles inutilisés. Vite et le parseur de métadonnées sont mis à jour pour les scans ; le lockfile est régénéré. La disposition et les styles existants sont conservés. Le formatage automatique couvre les fichiers d’outillage ajoutés et exclut les sources historiques ainsi que le cahier des charges pour éviter une réécriture de présentation dans ce setup. Le lint et les types couvrent ces sources.

Les tests initiaux sont des contrôles ciblés du socle existant. Ils ne constituent pas une recette de toutes les fonctionnalités décrites dans `docs/cdc/`.

## Reproduction locale

```sh
yarn install --frozen-lockfile --non-interactive
yarn validate
yarn test:server
yarn playwright install chromium
yarn test:e2e
actionlint
shellcheck scripts/ci/*.sh scripts/e2e/*.sh
sh scripts/ci/gitleaks.sh
```

Les scans Trivy se reproduisent avec l’image et les commandes de `scan.yml`. Le scan des licences examine aussi les dépendances installées. Aucune exception de vulnérabilité ni de secret n’est configurée.

Pour valider la pile Docker, lancer le mock OIDC sur l'hôte (ports 3002 et 8080 libres), puis :

```sh
MOCK_OIDC_ISSUER=http://host.docker.internal:3002 node server/dev/mock-oidc.ts &
export COMPOSE_FILE=docker-compose.yml:docker-compose.ci.yml COMPOSE_PROJECT_NAME=player-check IMAGE_TAG=check
docker compose build
docker compose up -d --wait --wait-timeout 180
sh scripts/ci/stack-check.sh
docker compose down --volumes --remove-orphans --rmi local
kill %1
```

`docker-compose.ci.yml` ne contient que des valeurs de développement (client `player-dev`, secret de session fixe) : aucun secret réel. Il publie le port sur `127.0.0.1:8080` et ajoute `host.docker.internal` pour joindre le mock depuis le conteneur, y compris sur Linux. La CI emploie un nom de projet et un tag d’image propres à chaque run ; le nettoyage ne touche que cette pile.

## Déploiement

L'image est unique : Node 24 sert le build Vite et l'API sur le port 8080, utilisateur 101, système de fichiers en lecture seule, `/tmp` éphémère. La base SQLite vit dans `/data`, seul chemin inscriptible.

### Configuration

Un fichier `.env` est obligatoire à côté de `docker-compose.yml` (modèle : `.env.example`). Variables :

- Obligatoires : `APP_URL` (origine publique, en HTTPS), `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_SECRET` (64 caractères hexadécimaux, `openssl rand -hex 32`).
- Facultatives : `PORT`, `DATA_DIR`, `OIDC_GROUPS_CLAIM`, `OIDC_GROUP_ADMIN`, `OIDC_GROUP_USERS`, `SESSION_TTL_HOURS`, `MAX_UPLOAD_MB`, `TRUST_PROXY`, `NODE_ENV`.

`MAX_UPLOAD_MB` (défaut 200) plafonne la taille d'un fichier importé depuis le panneau ; au-delà, l'API répond 413 `too_large` et le panneau refuse le fichier avant l'envoi (`GET /api/admin/limits`). Les pochettes déposées à la main sont limitées à 5 Mio, indépendamment de cette variable. Pour un reverse proxy, prévoir une limite de corps au moins égale.

Sans variable obligatoire, le conteneur journalise `Configuration error: ...` et s'arrête. Si l'émetteur OIDC est momentanément injoignable, le démarrage réessaie pendant un peu plus d'une minute (événement `oidc.discovery_retry`) avant d'abandonner (63 s d'attente cumulée, d'où un `start_period` de 70 s pour le healthcheck).

`PLAYER_DATA_PATH` choisit le stockage de `/data` : un chemin de l'hôte (bind, propriétaire uid 101) ou un nom de volume. Par défaut, le volume nommé `player-data`.

En mode `production` (valeur par défaut de l'image), `APP_URL` et `OIDC_ISSUER` doivent être en `https://`, sinon le conteneur refuse de démarrer. Un essai local en `http://` demande, dans `.env`, `NODE_ENV=development`, `APP_URL=http://127.0.0.1:8080` et les variables OIDC.

### HTTPS et reverse proxy

Le TLS est terminé par le reverse proxy (Dokploy, Traefik). Le serveur déduit toutes ses URL et l'attribut `Secure` du cookie de `APP_URL` (à garder en `https://`) et ne lit jamais les en-têtes `X-Forwarded-*`. `TRUST_PROXY` est réservé à un usage ultérieur (adresse IP du client pour la limitation de débit) et ne change rien aujourd'hui. Aucun port hôte n'est publié par le Compose de production.

### Pré-requis Authentik

- Un provider OAuth2/OpenID confidentiel, avec une application dont l'URL est `OIDC_ISSUER`.
- URL de redirection autorisée : `${APP_URL}/api/auth/callback`.
- Scopes : `openid profile email offline_access`, plus un scope mapping `groups` qui expose les groupes dans la revendication `groups`.
- Durée de validité du refresh token supérieure à `SESSION_TTL_HOURS`.
- Groupes `admin` et `users` (ou les noms définis par `OIDC_GROUP_*`).

### Dokploy

Le job `deploy:stack` valide un environnement Docker éphémère. L'instance réelle, son domaine et ses accès restent à connecter. Aucun déploiement réel n'est déclenché par ce setup.

1. Créer un service Compose Dokploy relié à `ItsMariusBC/Player` et à la branche `production`, fichier `docker-compose.yml`, avec les variables ci-dessus dans l'environnement du service (écrites dans `.env`).
2. Configurer le domaine sur le service `player`, port interne `8080`, avec HTTPS.
3. Connecter l'application GitHub Dokploy au dépôt privé. Pour un environnement de développement, créer un second service relié à `developpment` avec son propre domaine, son client OIDC et son volume.
4. Déployer uniquement un commit dont `CI required` a réussi. L'autodeploy natif sur push est à laisser désactivé tant qu'un déclenchement après réussite de la CI n'est pas connecté ; il pourrait démarrer avant les contrôles.

Voir la [documentation officielle Dokploy](https://docs.dokploy.com/docs/core/auto-deploy) pour le déclenchement par API après CI.

### Migration du catalogue

Le script importe un dossier de fichiers audio existant (récursif) dans le catalogue, sans jamais modifier ni supprimer les fichiers sources. Les sous-dossiers deviennent des dossiers du catalogue ; le manifeste (JSON : `name`, `author`, `url`, `folder`, pochette) fournit titre, artiste, dossier et pochette. Sauvegarder d'abord le volume `/data`. Les sources et le manifeste sont montés en lecture seule :

```
docker compose run --rm -v <dossier-de-musique>:/import:ro -v <manifeste.json>:/manifest.json:ro player node dist/server/migrate-catalog.js /import --manifest /manifest.json
```

En local : `yarn migrate:catalog <dossier> --manifest <fichier>`. Le script lit `DATA_DIR` (défaut `/data`) et n'exige pas les variables OIDC. Il affiche un rapport JSON (`imported`, `skipped`, `failed`) et sort en code 1 si un fichier a échoué.

Le script est idempotent : un fichier dont l'empreinte SHA-256 est déjà au catalogue est ignoré (`skipped`), donc relancer la commande est sans risque.

### Sortie réseau (recherche de métadonnées)

La recherche de métadonnées du panneau appelle des services publics en HTTPS (port 443). Le serveur doit pouvoir joindre :

- `musicbrainz.org` et `coverartarchive.org`, qui redirige vers `archive.org` et ses sous-domaines (`*.archive.org`) ;
- `api.deezer.com`, et `cdn-images.dzcdn.net` / `e-cdns-images.dzcdn.net` pour les pochettes ;
- `itunes.apple.com`, et `is1-ssl.mzstatic.com` à `is5-ssl.mzstatic.com` pour les pochettes.

Tout autre domaine est refusé pour les pochettes, quelle que soit la réponse d'un fournisseur. Sans cette sortie, `GET /api/admin/metadata/search` répond `partial: true` (certains fournisseurs seulement) ou 502 `provider_error` (aucun), et appliquer une pochette échoue en `cover_rejected` : le reste de l'application (lecture, import, édition manuelle) n'est pas affecté. Les pare-feu sortants peuvent donc rester fermés si la recherche n'est pas utilisée.

### Sauvegarde

Tout l'état est dans le volume `/data` (`PLAYER_DATA_PATH`) : base SQLite (catalogue, sessions, audit `admin_events`), `media/` et `incoming/`. Le sauvegarder en entier, arrêt du conteneur ou instantané de volume cohérent, avant une migration, une montée de version ou un import massif. Restaurer le volume avec l'image correspondante (voir Promotion et retour arrière).

### Recette du panneau d'administration

Après un déploiement, avec Authentik réel :

1. Se connecter avec un compte du groupe `admin` : le bouton d'administration apparaît à côté de la déconnexion et ouvre le panneau.
2. Importer un fichier FLAC, MP3 ou WAV (zone de dépôt, clic ou glisser-déposer) : l'import passe de `processing` à `ready` et le titre apparaît dans la liste et dans le lecteur après rafraîchissement du catalogue (60 s au plus).
3. Déposer le même fichier : l'import échoue avec la raison `duplicate`.
4. Modifier titre, artiste, album, dossier, pochette ; vérifier la lecture et la pochette mises à jour.
5. Lancer une recherche de métadonnées, appliquer une proposition avec sa pochette (nécessite la sortie réseau ci-dessus).
6. Supprimer le titre de test et le dossier de test.
7. Avec un compte du groupe `users` seul : le bouton est absent et `curl -H 'X-Requested-With: player' -b <cookie> .../api/admin/folders` renvoie 403 `admin_required`.

## Promotion et retour arrière

Ouvrir une PR de `developpment` vers `production`, attendre `CI required`, puis fusionner. Les deux branches exigent ce contrôle à jour et la résolution des conversations ; les force-push et suppressions sont refusés. Aucun autre approbateur n’est imposé sur ce dépôt personnel.

Pour revenir en arrière, créer un commit de revert du changement concerné, le faire passer par la même CI, puis redéployer via Dokploy. L’import initial reste accessible dans l’historique. Le serveur utilise SQLite avec des migrations : un retour arrière doit restaurer le volume `/data` en même temps que l'image précédente, car les migrations vont uniquement vers l'avant dans cet incrément. Les données locales du navigateur restent indépendantes du déploiement.

## État de la mise en place du 26 octobre 2026

Texte historique, antérieur à l'authentification OIDC : l'image était alors un serveur statique Nginx. Les contrôles actuels de l'image sont : `/healthz` 200, `/api/session` 401, `/api/auth/login` 302, utilisateur 101, système de fichiers racine en lecture seule, base SQLite dans `/data`.

Les contrôles locaux passent : lint, format de l’outillage, types, build, 6 tests unitaires, 2 tests navigateur, actionlint, ShellCheck, Hadolint, Gitleaks fichiers/historique, Trivy licences et vulnérabilités HIGH/CRITICAL. Docker a été construit et démarré : healthcheck, utilisateur non-root, HTML, Range de 128 octets et 404 d’un média absent sont vérifiés.

Le [premier run GitHub](https://github.com/ItsMariusBC/Player/actions/runs/40363045369) est refusé avant démarrage par GitHub : paiement récent échoué ou plafond Actions atteint. Aucun job n’a exécuté de commande. La validation distante reste à faire après correction de la facturation ou configuration d’un runner personnel.

La variable de dépôt `CI_RUNNER_LABELS` permet de choisir des labels JSON, par exemple `["self-hosted", "linux", "player"]`. Sans cette variable, les jobs utilisent `["ubuntu-24.04"]`. Un runner personnel Linux dédié doit disposer de Docker Compose, Node compatible avec les actions et des outils standard Ubuntu ; le setup installe Node, Bun et Yarn. Les runners de l’organisation Clyse ne peuvent pas être affectés directement à un dépôt personnel : un runner propre à Player doit être enregistré.

L’import initial de la configuration est validé localement. Les protections sont actives pour les changements suivants ; le blocage de facturation ne donne pas lieu à un statut CI artificiellement réussi.

Les workflows mis à jour pour le serveur (tests Node, e2e derrière le mock, contrôles de pile avec OIDC) n'ont été vérifiés qu'en local (actionlint, ShellCheck, `yarn validate`, `yarn test:e2e`, pile Compose). Ils restent non vérifiés à distance tant que le blocage de facturation dure.
