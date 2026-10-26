# Plateforme serveur, OIDC et administration du catalogue

Date : 26 octobre 2026. Statut : en attente d'approbation. Complète le cahier des charges (`docs/cdc/`), en particulier les chapitres 03 et 07, et tranche les points qu'il laissait ouverts.

## 1. Intention

Transformer le lecteur statique en application privée : chaque visiteur passe par Authentik (OIDC), les membres du groupe `users` écoutent le catalogue, les membres du groupe `admin` disposent en plus d'un panel d'administration pour alimenter et organiser ce catalogue. Le serveur devient la source de vérité pour l'identité, le catalogue, les dossiers, les médias et, plus tard, les favoris.

Motivation exprimée : ne plus jamais écrire à la main le chemin d'un fichier audio ou d'une pochette. On dépose un fichier, le système fait le reste.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**

- Accès au site réservé aux utilisateurs Authentik des groupes `users` ou `admin` ; refus explicite pour les autres, même connectés.
- Panel admin accessible par un bouton en bas à gauche, visible seulement pour `admin`, occupant la même surface que le visualiseur agrandi.
- Import par glisser-déposer (FLAC, MP3, WAV), traitement immédiat : tags, durée, pochette embarquée, publication jouable.
- Dossiers et sous-dossiers créés et gérés dans le panel ; un son se range par glisser-déposer.
- Identification assistée : clic droit sur un son → recherche chez des fournisseurs de métadonnées gratuits → application d'une proposition.
- Déploiement Docker portable sur n'importe quelle machine, avec un seul dossier de données.

**Non-objectifs (pour ce programme)**

- Playlists privées, ajout de sons depuis le lecteur, gestion des comptes Authentik depuis le site (CDC).
- Transcodage audio. Le format importé est servi tel quel.
- Multi-instance / haute disponibilité.

**Anti-objectifs**

- Toute refonte de la disposition ou des styles actuels du lecteur (voir `docs/cdc/08-suivi-realisation.md`). Le panel admin est une surface nouvelle ; le lecteur existant ne change que par l'ajout du bouton admin et de la porte d'authentification.
- Exposer un média ou une pochette par URL permanente contournant la session.
- Faire confiance au client pour un rôle, un propriétaire ou un chemin de fichier.

## 3. Contraintes

- Frontend conservé : React 19, Vite 8, Tailwind 4, architecture décrite dans `docs/architecture.md`.
- Runtime : Node 24 (déjà imposé par `engines`), TypeScript, un seul `yarn.lock`.
- Authentik existe déjà avec des comptes ; l'instance n'est pas modifiée par ce travail. Les tests automatisés utilisent un fournisseur OIDC factice ; la recette réelle se fait au déploiement par l'utilisateur.
- Aucun secret dans le dépôt ni dans le chat : configuration par variables d'environnement, `.env.example` documenté.

## 4. Décisions prises pendant le cadrage

| Sujet                | Décision                                                                                                                                                                                                                       | Par                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Mode Authentik       | OIDC côté serveur : Authorization Code + PKCE, `state` et `nonce`, validation issuer/audience/signature/expiration par `openid-client`.                                                                                        | Utilisateur (OIDC) et CDC |
| Groupes              | `admin` et `users`, lus dans la claim `groups` de l'ID token. Noms et claim configurables.                                                                                                                                     | Utilisateur               |
| API                  | Node 24 + Hono + `openid-client`.                                                                                                                                                                                              | Utilisateur               |
| Base                 | SQLite, fichier dans le dossier de données.                                                                                                                                                                                    | Utilisateur               |
| Stockage             | Un dossier racine `DATA_DIR` contenant tout (config, base, audio, pochettes, imports temporaires). Monté soit en volume Docker nommé (tout l'espace disponible), soit en bind sur un chemin de disque indiqué dans le compose. | Utilisateur               |
| Tests d'identité     | Fournisseur OIDC factice local pour le dev et les tests ; Authentik réel en recette.                                                                                                                                           | Utilisateur               |
| Métadonnées externes | Fournisseurs gratuits sans clé obligatoire.                                                                                                                                                                                    | Utilisateur               |

## 5. Architecture cible

### 5.1 Conteneur unique

Un seul service `player` dans `docker-compose.yml` : image Node 24 alpine qui sert les fichiers statiques du build Vite **et** l'API sur le même port (8080). _Mon choix_ : abandonner l'image nginx actuelle pour garder un seul processus à porter ; les en-têtes de sécurité et la politique de cache de `docker/default.conf` sont repris dans le serveur Node. Même utilisateur non-root, `read_only`, `cap_drop ALL`, healthcheck `/healthz` conservés.

HTTPS est terminé par le reverse proxy existant de l'hôte (celui qui sert déjà Authentik) ; le conteneur écoute en HTTP sur 8080 et n'est pas publié directement. _Mon choix_ : le serveur ne fait confiance aux en-têtes `X-Forwarded-*` que si `TRUST_PROXY=true` ; le drapeau `Secure` des cookies découle du schéma de `APP_URL` ; HSTS et CSP restent à la charge du proxy, les autres en-têtes de sécurité sont posés par le serveur. Les délais d'upload du proxy doivent couvrir `MAX_UPLOAD_MB` (point à noter dans le runbook).

Le dossier de données est le seul état. Exemple de compose :

```yaml
services:
  player:
    image: player:${IMAGE_TAG:-local}
    env_file: .env
    volumes:
      - ${PLAYER_DATA_PATH:-player-data}:/data # bind sur un disque, ou volume nommé
volumes:
  player-data:
```

### 5.2 Dossier de données

```
/data
  player.sqlite            base (WAL activé)
  media/<trackId>/original.<ext>   fichier audio tel qu'importé
  media/<trackId>/cover.<ext>      pochette (embarquée, fournie ou récupérée)
  incoming/<importId>/     zone temporaire, nettoyée après traitement
```

`trackId` est un identifiant opaque (ULID). Aucun chemin ne vient du client ; le serveur dérive tout du `trackId`. Sauvegarde = arrêt propre ou `sqlite3 .backup` + copie du dossier.

### 5.3 Modèle de données (SQLite)

| Table          | Colonnes principales                                                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`        | `id`, `issuer`, `subject` (unique ensemble), `display_name`, `email`, `groups` (JSON, dernière valeur vue), `last_seen_at`                                                                                                         |
| `sessions`     | `id` (aléatoire 256 bits, haché en base), `user_id`, `created_at`, `expires_at`, `refresh_token` (chiffré au repos avec `SESSION_SECRET`), `groups_checked_at`                                                                     |
| `folders`      | `id`, `parent_id` (nullable), `name`, `position` ; unicité (`parent_id`, `name`)                                                                                                                                                   |
| `tracks`       | `id`, `folder_id` (nullable = boîte d'arrivée), `title`, `artist`, `album`, `duration_ms`, `format`, `size_bytes`, `sha256` (unique), `cover_ext` (nullable), `status` (`ready`, `failed`), `position`, `created_at`, `updated_at` |
| `imports`      | `id`, `user_id`, `filename`, `state`, `error`, `track_id`, `created_at`                                                                                                                                                            |
| `admin_events` | `id`, `user_id`, `action`, `track_id`/`folder_id`, `detail` (JSON sans secret), `created_at`                                                                                                                                       |
| `favorites`    | `user_id`, `track_id` (unique ensemble) ; table créée maintenant, utilisée dans un incrément ultérieur                                                                                                                             |

Migrations SQL numérotées, appliquées au démarrage, idempotentes.

### 5.4 API HTTP (préfixe `/api`)

Toutes les réponses d'erreur sont JSON `{ "error": { "code", "message" } }`. Toute route hors `/api/auth/*` et `/healthz` exige une session valide ; les routes `/api/admin/*` exigent le groupe `admin`. Requêtes modifiantes protégées contre le CSRF par cookie `SameSite=Lax` **et** en-tête `X-Requested-With: player` obligatoire (vérifié côté serveur).

| Route                                            | Rôle                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/login`                            | Démarre le flux : génère PKCE/state/nonce, redirige vers Authentik.                                                                                                                                                                                                                    |
| `GET /api/auth/callback`                         | Échange le code, valide l'ID token, crée l'utilisateur si besoin, ouvre la session, redirige vers `/`.                                                                                                                                                                                 |
| `POST /api/auth/logout`                          | Supprime la session, révoque le refresh token si Authentik l'accepte, redirige vers la fin de session Authentik (`end_session_endpoint`) puis vers `/`.                                                                                                                                |
| `GET /api/session`                               | `{ user: { id, displayName }, role: "admin" \| "user", expiresAt }` ; `401` sans session ; `403 { code: "no_group" }` si connecté sans groupe reconnu.                                                                                                                                 |
| `GET /api/catalog`                               | Dossiers (arbre) et titres publiés, dans l'ordre de lecture.                                                                                                                                                                                                                           |
| `GET /api/media/:trackId`                        | Audio ; `HEAD` et `Range` honorés (206/416), `Cache-Control: private, no-store`.                                                                                                                                                                                                       |
| `GET /api/media/:trackId/cover`                  | Pochette ; `Cache-Control: private, max-age` court.                                                                                                                                                                                                                                    |
| `POST /api/admin/imports`                        | Multipart ; un fichier par requête ; réponse `202 { importId }`, traitement en arrière-plan.                                                                                                                                                                                           |
| `GET /api/admin/imports/:id`                     | État : `processing`, `ready` (avec `trackId`), `failed` (avec raison : format non reconnu, doublon `sha256`, fichier corrompu).                                                                                                                                                        |
| `GET/POST/PATCH/DELETE /api/admin/folders[/:id]` | Création, renommage, déplacement (cycle vers un descendant refusé, `400`), suppression (refusée si non vide sauf `?force=1` qui remonte le contenu dans le parent ; `409` si un dossier homonyme existe déjà dans le parent). Les `position` sont renumérotées après chaque mouvement. |
| `PATCH /api/admin/tracks/:id`                    | `title`, `artist`, `album`, `folderId`, `position`. Réécrit les tags dans le fichier audio.                                                                                                                                                                                            |
| `DELETE /api/admin/tracks/:id`                   | Retrait : supprime la ligne, les favoris associés et le dossier `media/<trackId>`. Confirmation côté UI.                                                                                                                                                                               |
| `POST /api/admin/tracks/:id/cover`               | Remplace la pochette : fichier envoyé, ou `proposalId` d'une recherche récente.                                                                                                                                                                                                        |
| `GET /api/admin/metadata/search?q=`              | Recherche agrégée chez les fournisseurs (titre, artiste, album, pochette, source).                                                                                                                                                                                                     |
| `POST /api/admin/tracks/:id/metadata`            | Applique une proposition par `proposalId` (champs + pochette téléchargée côté serveur).                                                                                                                                                                                                |

Limites : taille d'upload configurable (`MAX_UPLOAD_MB`, défaut 200), un import à la fois par requête, `429` sur la recherche de métadonnées au-delà d'une requête par seconde par fournisseur.

### 5.5 Identité et session

- Flux : Authorization Code + PKCE (`S256`), `state` et `nonce` stockés dans un cookie temporaire signé, scopes `openid profile email groups offline_access`.
- Identité stable : couple (`issuer`, `subject`). Nom et email ne servent qu'à l'affichage.
- Rôle : `admin` si la claim contient `OIDC_GROUP_ADMIN`, sinon `user` si elle contient `OIDC_GROUP_USERS`, sinon refus (`403 no_group`). `admin` n'a pas besoin de `users`.
- Session : cookie `player_session`, `HttpOnly`, `Secure` (sauf `NODE_ENV=development`), `SameSite=Lax`, `Path=/`. Durée absolue 12 h (`SESSION_TTL_HOURS`). _Mon choix_ : toutes les 15 minutes au plus, une requête authentifiée déclenche un rafraîchissement du token auprès d'Authentik ; si le rafraîchissement échoue ou si les groupes ont changé, la session est mise à jour ou invalidée. C'est la politique de réévaluation / révocation demandée par le CDC : un retrait de groupe est effectif en 15 minutes maximum, une suppression de compte aussi.
- Réévaluation : les groupes sont relus dans l'ID token renvoyé par le rafraîchissement (repli sur `userinfo` s'il n'y figure pas). Rafraîchissement refusé par Authentik (compte désactivé, consentement révoqué, token expiré) = session invalidée immédiatement, pas de tolérance jusqu'au TTL.
- Déconnexion ou expiration côté client : arrêt du média, vidage de l'état, redirection vers `/api/auth/login`.
- **Pré-requis côté Authentik** (à vérifier par l'utilisateur avant la recette de l'incrément 1, documentés dans le runbook) : provider OAuth2/OIDC de type confidentiel ; URL de redirection `${APP_URL}/api/auth/callback` ; scopes `openid`, `profile`, `email`, `offline_access` et un scope mapping exposant la claim `groups` ; durée du refresh token supérieure à `SESSION_TTL_HOURS`.

### 5.6 Médias

Le navigateur ne charge plus `/Drops.mp3` mais `/api/media/<trackId>`. L'élément `<audio>` envoie le cookie de session automatiquement (même origine). `HEAD` et `Range` sont supportés pour le seek. Les fichiers de `public/` sont retirés du build après migration (voir 7).

### 5.7 Import et traitement

1. Réception dans `incoming/<importId>/`.
2. Détection réelle du format par signature (pas par extension) : FLAC, MP3, WAV ; sinon `failed`.
3. Lecture des tags, durée et pochette embarquée avec `music-metadata` (déjà en dépendance).
4. Empreinte `sha256` ; doublon → `failed: duplicate` avec le `trackId` existant.
5. Déplacement atomique vers `media/<trackId>/`, insertion `tracks` en `ready`, `folder_id` nul (boîte d'arrivée).
6. Nettoyage de `incoming/<importId>/`.

_Mon choix_ : le traitement est asynchrone dès le départ. La requête d'upload répond `202 { importId }` dès que le fichier est écrit dans `incoming/`, puis un ouvrier unique en processus traite les imports dans l'ordre ; l'UI interroge `imports/:id`. Plusieurs fichiers déposés d'un coup sont envoyés par le client avec deux transferts en parallèle au plus, chacun avec sa barre de progression. Ainsi un gros FLAC ne dépend pas des délais du proxy au-delà du transfert lui-même.

`sha256` est l'empreinte du fichier **tel qu'il est stocké** : calculée à l'import pour détecter les doublons, recalculée après chaque réécriture de tags. L'écriture des tags dans le fichier est en mode meilleur effort : la base est toujours mise à jour ; si l'écriture échoue (WAV notamment), la réponse porte `tagsWritten: false` et le titre reste cohérent côté lecteur.

### 5.8 Métadonnées externes

Les propositions sont mises en cache côté serveur (identifiant opaque, durée de vie 15 minutes). Le client ne renvoie jamais une URL : `POST /api/admin/tracks/:id/metadata` et `/cover` reçoivent un `proposalId`, et c'est le serveur qui retrouve l'URL de pochette dans son cache. Téléchargement restreint aux hôtes des fournisseurs, redirections limitées à deux vers ces mêmes hôtes, résolution DNS vers une adresse privée refusée, taille maximale 5 Mio, type d'image vérifié par signature.

Fournisseurs, dans l'ordre : MusicBrainz (recherche d'enregistrements) + Cover Art Archive (pochettes), puis Deezer (recherche publique, pochettes 500 px), puis iTunes Search. Tous sans clé. Règles : `User-Agent` identifiant l'application (exigé par MusicBrainz), une requête par seconde et par fournisseur, délai maximal 5 s, agrégation et dédoublonnage par (titre, artiste, album). La requête part du serveur, jamais du navigateur. Le téléchargement d'une pochette proposée se fait aussi côté serveur, avec vérification du type d'image et une taille maximale.

### 5.9 Frontend

- **Porte d'entrée** : au chargement, `GET /api/session`. `401` → redirection vers `/api/auth/login`. `403 no_group` → écran « Accès refusé » sobre avec le nom du compte et un bouton de déconnexion. Sinon le lecteur, alimenté par `GET /api/catalog` (plus de `music/data.json` dans le bundle).
- **Catalogue** : les dossiers serveur remplacent le champ `folder` ; la liste gère les sous-dossiers (indentation par niveau). Les titres personnalisés `custom_songs` du `localStorage` ne sont plus chargés.
- **Bouton admin** : en bas à gauche, même style nu que « En lecture » (icône + « Administration »), visible pour `admin` seulement. Il ouvre un panneau de la taille et du style de la scène du visualiseur agrandi (`fixed inset-4 md:inset-8`, bordure fine, fond `purple-950/25`, sans blur) ; le reste de l'interface est démonté comme pour le visualiseur ; Échap ou bouton pour fermer ; la lecture continue.
- **Panel admin** (incréments 3 et 4) : colonne gauche arbre des dossiers (création, renommage, suppression, glisser-déposer de titres), zone centrale liste des titres du dossier sélectionné avec boîte d'arrivée, zone de dépôt de fichiers permanente, menu contextuel au clic droit (Rechercher les métadonnées, Modifier, Déplacer vers, Supprimer), panneau latéral d'édition des tags avec aperçu de pochette, dialogue de propositions de métadonnées. Toutes les actions passent par `playback`/`catalog` côté lecteur et par un petit client API typé côté admin ; aucune logique métier dans les vues.
- Déconnexion : les admins ont le bouton dans le panel ; les users simples ont un lien « Se déconnecter » en bas à gauche, à l'emplacement exact du bouton « Administration » des admins, même style nu. Décision utilisateur.

### 5.10 Configuration

| Variable                               | Rôle                                                              | Défaut                 |
| -------------------------------------- | ----------------------------------------------------------------- | ---------------------- |
| `APP_URL`                              | Origine publique, sert aux redirections OIDC                      | obligatoire            |
| `PORT`                                 | Port d'écoute                                                     | `8080`                 |
| `DATA_DIR`                             | Dossier de données                                                | `/data`                |
| `OIDC_ISSUER`                          | URL de l'application Authentik (`…/application/o/<slug>/`)        | obligatoire            |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Identifiants du provider                                          | obligatoires           |
| `OIDC_GROUPS_CLAIM`                    | Nom de la claim                                                   | `groups`               |
| `OIDC_GROUP_ADMIN`, `OIDC_GROUP_USERS` | Noms des groupes                                                  | `admin`, `users`       |
| `SESSION_SECRET`                       | Chiffrement des tokens au repos et signature du cookie temporaire | obligatoire, 32 octets |
| `SESSION_TTL_HOURS`                    | Durée absolue de session                                          | `12`                   |
| `MAX_UPLOAD_MB`                        | Taille maximale d'un fichier importé                              | `200`                  |

Au démarrage le serveur valide la configuration et refuse de démarrer si une variable obligatoire manque. URL de redirection à déclarer dans Authentik : `${APP_URL}/api/auth/callback`.

## 6. Développement et tests

- Monorepo léger : `server/` (API Hono, TypeScript, compilé avec `tsc` vers `dist/server`), frontend inchangé à la racine. Scripts : `yarn dev` lance Vite et l'API (`tsx watch`) avec proxy `/api` vers l'API ; `yarn build` construit les deux ; `yarn validate` couvre les deux.
- **Fournisseur OIDC factice** : `server/dev/mock-oidc.ts` basé sur `oidc-provider`, lancé par `yarn dev` et par les tests, avec trois comptes : `admin@test` (groupe admin), `user@test` (groupe users), `nobody@test` (aucun groupe). Il expose refresh token, `end_session_endpoint`, révocation, la claim `groups`, et une route de contrôle réservée aux tests (`POST /mock/users/:id` pour changer les groupes ou désactiver le compte) afin de vérifier la politique de réévaluation. Un `.env.development` pointe dessus. Il n'est jamais inclus dans l'image Docker.
- Tests unitaires (Bun, existants) : rôle à partir des groupes, politique de session, détection de format, agrégation des métadonnées.
- Tests API (Bun + `fetch` sur l'application Hono en mémoire, SQLite temporaire) : chaque route en anonyme / sans groupe / users / admin, `Range` 206/416, CSRF, doublon d'import.
- E2E Playwright : connexion via le fournisseur factice pour les trois comptes, refus sans groupe, lecture d'un titre, import d'un fichier par glisser-déposer et apparition dans le lecteur.
- CI : les workflows existants s'étendent à `server/` ; l'étape Docker construit la nouvelle image et vérifie `/healthz` et un `401` sur `/api/session`.

## 7. Migration

Un script `migrate-catalog` embarqué dans l'image lit un dossier source monté (`docker compose run -v ./public:/import player node dist/server/migrate.js /import`) : il importe les fichiers audio avec le même pipeline que le panel (§5.7), applique les dossiers de `music/data.json` (`Chill`, `Électro`, `Rap FR`) et conserve l'ordre comme `position`. Il est idempotent grâce au `sha256`. Les anciens identifiants numériques ne sont que des index de file calculés à l'exécution ; rien n'en dépend dans le stockage local, ils ne sont pas préservés. Après vérification, les MP3 et JPG sont retirés de `public/` et de l'image ; `music/data.json` et `music/generate.mjs` disparaissent. Les anciennes URL `/Drops.mp3` répondent `404`.

## 8. Incréments de livraison

0. **Point de départ** : l'arbre de travail frontend actuel (non commité) est commité tel quel avant tout travail serveur, pour que chaque incrément parte d'une référence stable.
1. **Socle et OIDC** : `server/`, SQLite et migrations, configuration, fournisseur factice, flux de connexion, session, `/api/session`, porte d'entrée frontend, écran de refus, déconnexion, image Docker unique, CI. Le catalogue reste `data.json` pendant cet incrément.
2. **Catalogue serveur et médias** : tables `folders`/`tracks`, `GET /api/catalog`, `GET /api/media`, lecteur branché sur l'API, script de migration, retrait des fichiers publics.
3. **Panel admin, import et dossiers** : bouton bas-gauche, panneau, import par glisser-déposer, arbre de dossiers, rangement, suppression, édition des tags.
4. **Identification** : menu contextuel, fournisseurs de métadonnées, application d'une proposition, remplacement de pochette.
5. **Favoris** (CDC T055) : hors de ce document, ouvert ensuite.

Chaque incrément est livré avec ses tests et son passage de `yarn validate` ; l'incrément 1 est recetté par l'utilisateur sur Authentik réel avant l'incrément 2.

## 9. Laissé au constructeur

- Bibliothèque SQLite (module natif `node:sqlite` de Node 24 ou `better-sqlite3`) et format exact des migrations.
- Bibliothèque de parsing multipart et d'écriture des tags (lecture : `music-metadata` ; écriture : à choisir, FLAC/MP3/WAV).
- Détails d'implémentation du fournisseur factice et des fixtures.
- Organisation interne de `server/` tant que les contrats du §5.4 sont respectés.
- Détails visuels du panel admin dans les limites du style existant (verre, violet, typographie Inter).

## 10. Risques

- Fournisseurs externes indisponibles ou limités : la recherche échoue proprement, l'édition manuelle reste possible.
- Écriture de tags dans WAV : support inégal ; en cas d'échec, les métadonnées restent en base et le fichier n'est pas modifié (signalé dans la réponse).
- Gros fichiers FLAC : traitement synchrone de quelques secondes ; le passage en file asynchrone est prévu par le contrat `imports/:id`.
- `read_only` du conteneur : seuls `/data` et `/tmp` sont inscriptibles ; toute écriture ailleurs est un bug à corriger, pas une raison de lever la contrainte.
