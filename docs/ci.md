# CI/CD de Player

## Référence

La structure reprend [celle du site Clyse](https://github.com/Clyse-Devs/clyse.dev/tree/dev/.github/workflows) : workflows réutilisables par étape, scans bloquants, artefacts et contrôle final `CI required`. Player utilise les runners GitHub `ubuntu-latest`, les runners de l’organisation Clyse ne sont pas partagés avec ce dépôt personnel.

Chaque push sur `developpment` ou `production`, tag `v*`, PR vers ces branches, lancement manuel et contrôle hebdomadaire exécute toute la pipeline. Les PR obsolètes sont annulées. Les exécutions de branche restent actives.

| Étape       | Contrôles                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Lint        | Oxlint sur tout le code, format de l’outillage, TypeScript, actionlint, ShellCheck                                                      |
| Scan        | Trivy vulnérabilités HIGH/CRITICAL et licences, Gitleaks fichiers et historique complet                                                 |
| Build       | Build Vite et artefact `dist/` conservé 7 jours                                                                                         |
| Test        | Tests Bun du formatage des durées, Playwright sur le build récupéré : montage du lecteur/catalogue et lecture HTTP partielle des médias |
| Deploy      | Hadolint, validation Compose, construction de l’image, démarrage avec healthcheck, HTTP et Range vérifiés dans le conteneur non-root    |
| CI required | Refuse tout échec, annulation ou contrôle ignoré                                                                                        |

Lint et scans démarrent ensemble. Build et validation Docker attendent le lint ; les tests attendent le build. Les rapports JUnit, traces Playwright et SBOM sont gardés 14 jours. Les sorties sont privées, rattachées au run GitHub.

Les actions sont épinglées par SHA, les images Docker par digest. Le token est limité à `contents: read` et n’est pas persisté dans le checkout. Aucun secret de production n’est utilisé. Les dépendances s’installent avec `--frozen-lockfile` et les versions de Node, Bun et Yarn sont fixées.

La mise en place corrige la prop `MotionConfig.features` incompatible et des symboles inutilisés. Vite et le parseur de métadonnées sont mis à jour pour les scans ; le lockfile est régénéré. La disposition et les styles existants sont conservés. Le formatage automatique couvre les fichiers d’outillage ajoutés et exclut les sources historiques ainsi que le cahier des charges pour éviter une réécriture de présentation dans ce setup. Le lint et les types couvrent ces sources.

Les tests initiaux sont des contrôles ciblés du socle existant. Ils ne constituent pas une recette de toutes les fonctionnalités décrites dans `docs/cdc/`.

## Reproduction locale

```sh
yarn install --frozen-lockfile --non-interactive
yarn validate
yarn playwright install chromium
yarn test:e2e
actionlint
shellcheck scripts/ci/*.sh
sh scripts/ci/gitleaks.sh
```

Les scans Trivy se reproduisent avec l’image et les commandes de `scan.yml`. Le scan des licences examine aussi les dépendances installées. Aucune exception de vulnérabilité ni de secret n’est configurée.

Pour valider Docker sans publier de port :

```sh
COMPOSE_PROJECT_NAME=player-check IMAGE_TAG=check docker compose build
COMPOSE_PROJECT_NAME=player-check IMAGE_TAG=check docker compose up -d --wait
COMPOSE_PROJECT_NAME=player-check IMAGE_TAG=check sh scripts/ci/stack-check.sh
COMPOSE_PROJECT_NAME=player-check IMAGE_TAG=check docker compose down --volumes --remove-orphans --rmi local
```

La CI emploie un nom de projet et un tag d’image propres à chaque run ; le nettoyage ne touche que cette pile.

## Mise en ligne avec Dokploy

Le job `deploy:stack` valide un environnement Docker éphémère, comme dans Clyse. L’instance réelle, son domaine et ses accès restent à connecter. Aucun déploiement réel n’est déclenché par ce setup.

1. Créer un service Compose Dokploy relié à `ItsMariusBC/Player` et à la branche `production`, fichier `docker-compose.yml`.
2. Configurer le domaine sur le service `player`, port interne `8080`, avec HTTPS. Aucun port hôte n’est publié par le Compose de production.
3. Connecter l’application GitHub Dokploy au dépôt privé. Pour un environnement de développement, créer un second service relié à `developpment` avec son propre domaine.
4. Déployer uniquement un commit dont `CI required` a réussi. L’autodeploy natif sur push est à laisser désactivé tant qu’un déclenchement après réussite de la CI n’est pas connecté ; il pourrait démarrer avant les contrôles.

Voir la [documentation officielle Dokploy](https://docs.dokploy.com/docs/core/auto-deploy) pour le déclenchement par API après CI.

L’image finale sert uniquement les fichiers statiques avec Nginx, utilisateur 101, système de fichiers en lecture seule et `/tmp` éphémère. Le serveur gère les requêtes Range et renvoie 404 pour un média absent. Le catalogue et les médias déjà présents restent intégrés au build.

## Promotion et retour arrière

Ouvrir une PR de `developpment` vers `production`, attendre `CI required`, puis fusionner. Les deux branches exigent ce contrôle à jour et la résolution des conversations ; les force-push et suppressions sont refusés. Aucun autre approbateur n’est imposé sur ce dépôt personnel.

Pour revenir en arrière, créer un commit de revert du changement concerné, le faire passer par la même CI, puis redéployer via Dokploy. L’import initial reste accessible dans l’historique. Le runtime actuel étant statique, ce retour du code ne nécessite pas de migration de base de données ; les données locales du navigateur restent indépendantes du déploiement.
