# Player

Lecteur musical React 19, TypeScript, Vite 8 et Tailwind CSS 4. Le projet existant est conservé dans ce dépôt privé.

## Développement

Prérequis : Node indiqué dans `.node-version`, Yarn 1.22.22 et Bun indiqué dans `.bun-version` pour les tests unitaires.

```sh
yarn install --frozen-lockfile
yarn dev
```

`yarn dev` lance en parallèle Vite (`http://localhost:3000`), l'API (configurée par `.env.development`, versionné, sans secret réel) et un fournisseur OIDC factice sur le port 3002. Trois comptes de test, à choisir sur l'écran de connexion factice : `admin@test` (groupe admin), `user@test` (groupe users) et `nobody@test` (aucun groupe, accès refusé). `yarn.lock` est le seul lockfile du projet.

```sh
yarn validate
yarn playwright install chromium
yarn test:e2e
```

`yarn validate` exécute lint, format des fichiers d’outillage, types, tests unitaires et build. Les tests navigateur utilisent le build `dist/`. `yarn generate:music` régénère le catalogue à partir de `public/` et peut modifier les pochettes.

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

Ouvrir `http://127.0.0.1:8080`. `PLAYER_PORT` permet de changer le port, `PLAYER_DATA_PATH` de stocker `/data` dans un dossier de l'hôte. Avec le fournisseur factice lancé sur l'hôte (`MOCK_OIDC_ISSUER=http://host.docker.internal:3002 yarn dev:oidc`), utiliser `OIDC_ISSUER=http://host.docker.internal:3002`. Arrêter avec la même commande Compose suivie de `down`.
