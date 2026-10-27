# Player

Lecteur musical React 19, TypeScript, Vite 8 et Tailwind CSS 4. Le projet existant est conservé dans ce dépôt privé.

- Lecture continue : Media Session (touches multimédia, écran de verrouillage), reprise du dernier titre et de sa position au rechargement, pré-chargement du titre suivant.

## Développement

Prérequis : Node indiqué dans `.node-version`, Yarn 1.22.22 et Bun indiqué dans `.bun-version` pour les tests unitaires.

```sh
yarn install --frozen-lockfile
yarn dev
```

`yarn dev` lance en parallèle Vite (`http://localhost:3000`), l'API (configurée par `.env.development`, versionné, sans secret réel) et un fournisseur OIDC factice sur le port 3002. Trois comptes de test, à choisir sur l'écran de connexion factice : `admin@test` (groupe admin), `user@test` (groupe users) et `nobody@test` (aucun groupe, accès refusé). `yarn.lock` est le seul lockfile du projet.

Quand `DEV_BYPASS_LOGIN=true` (activé dans `.env.development`), l'écran de connexion de test propose « Entrer en admin » et « Entrer en user », qui ouvrent une session sans passer par le fournisseur OIDC, avec les identités `dev-admin` / `dev-user` (émetteur `dev-bypass`). Ces sessions ne sont pas revérifiées auprès du fournisseur. Le serveur refuse de démarrer si `DEV_BYPASS_LOGIN=true` avec `NODE_ENV=production`.

```sh
yarn validate
yarn playwright install chromium
yarn test:e2e
```

`yarn validate` exécute lint, format des fichiers d’outillage, types, tests unitaires et build. Les tests navigateur utilisent le build `dist/`.

Le catalogue vit dans le dossier de données de l'API (`DATA_DIR`) et n'est plus versionné. Pour remplir le dossier de données de développement avec des fichiers audio existants :

```sh
DATA_DIR=./.data yarn migrate:catalog <dossier-de-musique> [--manifest <fichier.json>]
```

Les tests navigateur remplissent leur propre catalogue à partir de `tests/e2e/fixtures/`. Les scénarios du panneau d'administration (`tests/e2e/admin.spec.ts`) et des demandes de sons (`tests/e2e/requests.spec.ts`) se connectent avec `admin@test` et `user@test` via le fournisseur factice ; ils tournent avec `yarn test:e2e`.

## Administration

Les membres du groupe `admin` voient un bouton à côté de la déconnexion, qui ouvre le panneau d'administration du catalogue : créer, renommer, déplacer et supprimer des dossiers ; importer des fichiers FLAC, MP3 ou WAV (clic ou glisser-déposer, traités l'un après l'autre côté serveur) ; modifier titre, artiste, album, dossier et pochette ; compléter un titre depuis des bases libres (MusicBrainz, Deezer, iTunes). Les membres du groupe `users` n'ont que la lecture : `/api/admin/*` leur répond 403.

Tout utilisateur connecté peut proposer un titre au catalogue : bouton « Demander un son » sous la file d'attente (recherche chez les fournisseurs ou saisie libre, suivi dans « Mes demandes »). Les administrateurs les traitent dans l'onglet « Demandes » du panneau d'administration (valider ou supprimer).

Les modifications de titre, d'artiste et d'album sont aussi écrites dans les tags du fichier, au mieux : MP3 et FLAC oui, WAV jamais (le catalogue reste la référence). Une panne de l'écriture de tags n'annule pas la modification. La taille maximale d'un import se règle avec `MAX_UPLOAD_MB` (200 par défaut). La recherche de métadonnées demande une sortie HTTPS du serveur vers les fournisseurs ; sans elle, le reste fonctionne. Le volume des titres est normalisé à la lecture (cible -14 LUFS) d'après une mesure ffmpeg faite à l'import ; les titres sans mesure (plus anciens, ou importés par `yarn migrate:catalog`, qui ne mesure pas) se rattrapent depuis l'onglet Catalogue de l'administration : la passe s'arrête seule (le statut cesse d'être relu quand `running` retombe), les titres illisibles ou silencieux sont comptés « sans mesure », `updated_at` reste intact, la tentative est consignée dans la colonne `loudness_measured_at`, et un ffmpeg absent répond 409 `ffmpeg_unavailable` (`FFMPEG_PATH` règle le binaire). Détails des routes et des couches dans [docs/architecture.md](docs/architecture.md), exploitation dans [docs/ci.md](docs/ci.md).

## Branches et livraison

- `developpment` : branche par défaut, intégration du travail courant.
- `production` : version destinée à la mise en ligne, alimentée par PR depuis `developpment`.
- Les PR vers ces deux branches doivent passer `CI required`.

La [documentation CI/CD](docs/ci.md) détaille les contrôles, Docker et le retour arrière.

L'[architecture du lecteur](docs/architecture.md) décrit les couches (moteur, contrôleurs, composition, présentation) et les raccourcis clavier.

## Docker local

L'image unique sert l'application et l'API. Elle exige un fichier `.env` (modèle : `.env.example`, détails dans [docs/ci.md](docs/ci.md)) et un fournisseur OIDC joignable depuis le conteneur.

```sh
cp .env.example .env   # puis renseigner les variables obligatoires
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build --wait
```

L'image tourne en `NODE_ENV=production`, qui impose `APP_URL` et `OIDC_ISSUER` en `https://`. Pour un essai local en `http://`, mettre dans `.env` `NODE_ENV=development`, `APP_URL=http://127.0.0.1:8080` et les variables OIDC. Le serveur déduit toutes ses URL et l'attribut `Secure` du cookie de `APP_URL` et ne lit jamais `X-Forwarded-*`. `TRUST_PROXY` est réservé à un usage ultérieur (adresse IP du client pour la limitation de débit) et ne change rien aujourd'hui.

Ouvrir `http://127.0.0.1:8080`. `PLAYER_PORT` permet de changer le port, `PLAYER_DATA_PATH` de stocker `/data` dans un dossier de l'hôte. Avec le fournisseur factice lancé sur l'hôte (`MOCK_OIDC_ISSUER=http://host.docker.internal:3002 yarn dev:oidc`), utiliser `OIDC_ISSUER=http://host.docker.internal:3002`. Arrêter avec la même commande Compose suivie de `down`.
