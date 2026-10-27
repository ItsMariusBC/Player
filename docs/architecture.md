# Architecture du lecteur

Le code est organisé en couches. Une couche ne dépend que de celles situées au-dessus dans le tableau.

| Couche       | Fichiers                                                                               | Rôle                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moteur       | `lib/music-manager.ts`, `lib/queue-manager.ts`                                         | Élément `<audio>`, `AudioContext`, file de lecture (alimentée par le catalogue serveur). Émet des `PlayerEvent` (`play`, `pause`, `track`, `time`, `queue`). Ignore l'interface.                                                                                                                                                                                  |
| Contrôleurs  | `lib/playback-controller.ts`, `lib/notification-manager.ts`, `lib/shortcut-manager.ts` | `PlaybackController` est l'unique point d'entrée des actions (lecture, pause, stop, piste suivante/précédente, seek, volume). `NotificationManager` transforme les événements en une seule notification visible à la fois. `ShortcutManager` relie le clavier au contrôleur.                                                                                      |
| Composition  | `lib/player-runtime.ts`                                                                | `createPlayerRuntime()` assemble moteur, contrôleurs et raccourcis, et expose `destroy()`. C'est le seul endroit où les instances sont créées.                                                                                                                                                                                                                    |
| Présentation | `components/**`, `lib/hooks/**`                                                        | Composants React sans logique métier. `usePlaybackState(music)` fournit l'état courant ; les actions passent par `playback`. `useSongGradient(song)` fournit les couleurs du fond. Pour les admins, `AdminButton` s'affiche à côté du lien de déconnexion (`CornerActions`) et ouvre `AdminPanel` (démonte le reste de l'interface comme le visualiseur agrandi). |

## Règles

- Un composant ne modifie jamais l'état du moteur directement : il appelle `playback.*`.
- Un composant n'écoute jamais `<audio>` : il lit `usePlaybackState` ou s'abonne à `music.subscribe`.
- Les notifications sont une politique (`lib/notification-manager.ts`) et une vue (`components/song-notification.tsx`). La politique est testée sans DOM.
- Le catalogue vient de `GET /api/catalog` (`lib/catalog.ts`, `useCatalog()` : chargement au montage, toutes les 60 s et sur `refresh()`). `flattenCatalog` en tire la file : à chaque niveau, les sous-dossiers d'abord (profondeur d'abord, ordre de l'arbre) puis les titres du niveau par `position` ; les titres racine viennent donc en dernier. La liste affiche l'arbre dans ce même ordre. Médias et pochettes sont servis par `/api/media/:id` et `/api/media/:id/cover` (même origine, cookie de session). Aucun média ni `music/data.json` n'est plus versionné : le dossier `music/` et les fichiers de `public/` (hors `favicon.ico`) ont disparu, le catalogue vit dans `DATA_DIR` et s'y importe avec `yarn migrate:catalog`.
- À chaque nouveau catalogue, `queueManager.setSongs` conserve le titre courant par `id` ; s'il a disparu, la file reprend au même index. Un rafraîchissement sans changement du titre courant ne relance pas la lecture.
- Le fond dégradé est dérivé de la pochette (`lib/palette.ts`).
- Le fond est une scène React Three Fiber maison (`components/gradient/`), shaders repris de shadergradient 1.3.5 (MIT). Les couleurs sont des uniforms mutés dans la boucle de rendu : un changement de piste ne provoque ni re-render React ni recompilation de shader. Rendu à la demande à 30 i/s (`FRAMES_PER_SECOND`), `dpr` 1, sans `preserveDrawingBuffer`, chargé en chunk séparé après le premier rendu.

## Serveur et administration

Le serveur (`server/src/`, Node 24, Hono, SQLite) a ses propres couches. Une couche ne dépend que de celles situées au-dessus dans le tableau.

| Couche         | Fichiers                                                                                                                                             | Rôle                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue      | `catalog/folders.ts`, `catalog/tracks.ts`, `catalog/tree.ts`, `catalog/tx.ts`                                                                        | Dépôt SQLite des dossiers et des titres. `inTransaction` (`tx.ts`) ouvre un `SAVEPOINT`, donc les appels s'imbriquent. `tree.ts` construit l'arbre. Erreurs typées : `FolderConflictError`, `FolderCycleError`, `FolderNotEmptyError`, `NotFoundError`.                                                                                                                                             |
| Médias         | `media/storage.ts`, `media/probe.ts`, `media/image.ts`, `media/tags.ts`                                                                              | Fichiers dans `DATA_DIR/media/<trackId>/original.<ext>` et `cover.<ext>` ; dépôts en cours dans `DATA_DIR/incoming/<importId>/`. `probe.ts` détecte le format par signature (l'extension n'est jamais crue), lit les tags avec music-metadata et calcule le SHA-256 en flux. `tags.ts` écrit les tags au mieux (node-id3 pour MP3, metaflac-js pour FLAC) ; un WAV n'est jamais réécrit.            |
| Import         | `media/ingest.ts`, `admin/imports.ts`                                                                                                                | `ingestFile` est le pipeline commun (sondage, doublon par empreinte, publication, ligne SQL) ; le script de migration et la file asynchrone l'appellent. `admin/imports.ts` traite un import à la fois (chaîne de promesses, donc pas de course sur la détection de doublon).                                                                                                                       |
| Administration | `routes/admin-folders.ts`, `routes/admin-tracks.ts`, `routes/admin-imports.ts`, `routes/admin-metadata.ts`, `admin/track-edit.ts`, `admin/events.ts` | Routes sous `/api/admin/*`, réservées au groupe admin. `track-edit.ts` porte le verrou par titre (`createTrackLocks`), partagé par PATCH, DELETE, pochette et application de métadonnées. `events.ts` écrit une ligne d'audit dans `admin_events` pour chaque mutation (jamais de secret dans `detail`).                                                                                            |
| Métadonnées    | `metadata/providers.ts`, `metadata/search.ts`, `metadata/fetch-guard.ts`                                                                             | Recherche chez MusicBrainz (+ Cover Art Archive), Deezer et iTunes. Une requête par seconde et par fournisseur, imposée en attendant ; 5 s de budget par fournisseur ; propositions gardées 15 min sous des identifiants opaques. `fetch-guard.ts` télécharge les pochettes proposées (voir ci-dessous).                                                                                            |
| Demandes       | `requests/repo.ts`, `routes/requests.ts`, `routes/admin-requests.ts`                                                                                 | Demandes de sons des utilisateurs (table `song_requests`, migration 3). `repo.ts` porte les règles : limite de 20 demandes en attente par utilisateur (`RequestLimit`), doublon titre+artiste normalisé. Les routes `/api/requests*` sont ouvertes à toute session, `/api/admin/requests*` au groupe admin. La recherche de propositions réutilise l'instance `MetadataSearch` de l'administration. |

Normalisation du volume : à l'import, `media/loudness.ts` mesure le titre avec ffmpeg (filtre `ebur128`, binaire `FFMPEG_PATH`, `ffmpeg` par défaut ; l'image Docker l'embarque). Le résultat est stocké dans deux colonnes de `tracks` (migration 4) : `loudness_lufs` (loudness intégrée) et `true_peak_dbtp` (crête vraie), toutes deux `NULL` quand la mesure manque, échoue ou donne `-inf` (silence). Une mesure en échec n'empêche pas l'import. `GET /api/catalog` expose `loudnessLufs` et `truePeakDbtp`. Côté client, `lib/loudness.ts` (`replayGain`) calcule le gain en dB : cible -14 LUFS, borné à [-20, +12] dB, puis réduit pour que la crête vraie reste sous le plafond de -1 dBTP ; 0 dB si le titre n'est pas mesuré. Le lecteur applique ce gain par un `GainNode` par élément audio dans le graphe Web Audio. Les titres importés avant la migration se rattrapent depuis l'onglet Catalogue (« Analyser les titres restants ») : `GET /api/admin/loudness` donne `{ total, measured, pending, available }` et `POST /api/admin/loudness/backfill` met les titres restants en file (202 `{ queued }`), l'interface relisant l'état toutes les 2 s tant qu'il en reste.

Import asynchrone : `POST /api/admin/imports` (multipart) écrit le fichier dans `incoming/<importId>/`, crée une ligne `imports` à l'état `processing` et répond 202 avec `importId`. Le worker la passe à `ready` (avec `trackId`) ou `failed` avec `error.reason` : `duplicate`, `unsupported_format` ou `internal`. Le panneau suit les imports avec `GET /api/admin/imports` et `/:id`.

Pochette proposée par un fournisseur : l'URL vient du cache de propositions, jamais du client. `fetch-guard.ts` n'accepte que HTTPS et une liste de domaines (`COVER_HOSTS`), résout le DNS et refuse toute adresse privée, boucle locale, lien local ou réservée, épingle la connexion sur les adresses vérifiées, suit au plus 2 redirections (revalidées à chaque saut), plafonne le corps à 5 Mio et vérifie la signature JPEG/PNG/WebP. Un refus donne `cover_rejected` (422) : le texte de la proposition est déjà appliqué et la réponse contient le titre mis à jour (`track`, `coverApplied: false`).

Front d'administration : `components/admin/*` (`admin-panel`, `folder-tree`, `track-table`, `track-editor`, `metadata-dialog`, `upload-zone`, `context-menu`), `lib/admin-api.ts` (appels typés, en-tête CSRF), `lib/import-queue.ts` (file côté client : envoi en série, refus des fichiers trop gros d'après `GET /api/admin/limits`, suivi de l'état serveur) et `lib/hooks/use-import-queue.ts`. Une pochette remplacée change `updatedAt` du titre ; l'URL de pochette porte `?v=<updatedAt>` pour contourner le cache.

### API

Toutes les routes sont sous `/api`. Les méthodes qui modifient exigent l'en-tête `X-Requested-With: player` (403 `csrf` sinon). Les erreurs sont `{ "error": { "code", "message" } }`.

| Route                                                  | Accès   | Rôle                                                                                                            |
| ------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /api/session`                                     | session | Utilisateur et rôle.                                                                                            |
| `GET /api/catalog`                                     | session | Arbre des dossiers et titres prêts.                                                                             |
| `GET`, `HEAD /api/media/:id`                           | session | Audio, `Range` accepté (206), `Cache-Control: private, no-store`. 404 si le titre n'est pas prêt.               |
| `GET`, `HEAD /api/media/:id/cover`                     | session | Pochette.                                                                                                       |
| `GET /api/admin/limits`                                | admin   | `{ maxUploadBytes }`.                                                                                           |
| `GET /api/admin/loudness`                              | admin   | `{ total, measured, pending, available }` (`available` : ffmpeg exécutable).                                    |
| `POST /api/admin/loudness/backfill`                    | admin   | Met en file la mesure des titres prêts non mesurés, 202 `{ queued }`.                                           |
| `POST /api/admin/imports`                              | admin   | Dépôt multipart (champ fichier), 202 `{ importId }`. 413 `too_large`, 400 `bad_request`.                        |
| `GET /api/admin/imports`, `GET /api/admin/imports/:id` | admin   | État des imports (`limit` 1 à 200, défaut 50). 404 `not_found`.                                                 |
| `GET`, `POST /api/admin/folders`                       | admin   | Arbre ; création. 409 `folder_conflict` (nom déjà pris au même niveau).                                         |
| `PATCH /api/admin/folders/:id`                         | admin   | Renommer, déplacer, repositionner. 409 `folder_conflict`, 400 `folder_cycle`, 404 `not_found`.                  |
| `DELETE /api/admin/folders/:id`                        | admin   | 409 `folder_not_empty` sauf `?force=1`.                                                                         |
| `PATCH`, `DELETE /api/admin/tracks/:id`                | admin   | Modifier titre, artiste, album, dossier, position (tags réécrits au mieux) ; supprimer titre et fichiers (204). |
| `POST /api/admin/tracks/:id/cover`                     | admin   | Remplacer la pochette (JPEG, PNG ou WebP, 5 Mio). 413 `too_large`, 400 `bad_request`.                           |
| `GET /api/admin/metadata/search?q=`                    | admin   | 2 à 200 caractères. `{ proposals, partial }` ; 502 `provider_error` si aucun fournisseur n'a répondu.           |
| `POST /api/admin/tracks/:id/metadata`                  | admin   | `{ proposalId, applyCover }`. 404 `proposal_expired`, 422 `cover_rejected`.                                     |

Demandes de sons (la recherche n'est montée que si le moteur de métadonnées l'est) :

| Route                                 | Accès   | Rôle                                                                                                                                                                   |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/requests/search?q=`         | session | Comme `/api/admin/metadata/search` (même limite d'une requête par seconde et par fournisseur). 400 `bad_request`, 502 `provider_error`.                                |
| `GET /api/requests`                   | session | `{ requests }` de l'utilisateur, récentes d'abord, 50 au plus.                                                                                                         |
| `POST /api/requests`                  | session | `{ proposalId }` ou `{ title, artist? }` ; 201 `{ request }`. 404 `proposal_expired`, 409 `request_duplicate`, 409 `request_limit` (20 en attente), 400 `bad_request`. |
| `DELETE /api/requests/:id`            | session | 204 si la demande est la sienne et en attente ; 404 `request_not_found` sinon.                                                                                         |
| `GET /api/admin/requests`             | admin   | `{ requests }` avec `requestedBy` : en attente puis validées, 200 au plus.                                                                                             |
| `POST /api/admin/requests/:id/accept` | admin   | `{ request }`. 404 `request_not_found`, 409 `request_not_pending`. Événement `request_accept`.                                                                         |
| `DELETE /api/admin/requests/:id`      | admin   | 204 ; 404 `request_not_found`. Événement `request_delete`.                                                                                                             |

Table `song_requests` (migration `id: 3`) :

| Colonne                      | Type et contrainte                                         |
| ---------------------------- | ---------------------------------------------------------- |
| `id`                         | `TEXT PRIMARY KEY`                                         |
| `user_id`                    | `TEXT NOT NULL`, référence `users(id)` `ON DELETE CASCADE` |
| `title`, `artist`            | `TEXT NOT NULL` (`artist` vaut `''` par défaut)            |
| `album`, `year`, `cover_url` | `TEXT`, `INTEGER`, `TEXT` nullables                        |
| `source`                     | `musicbrainz`, `deezer`, `itunes` ou `manual`              |
| `status`                     | `pending` (défaut) ou `accepted`                           |
| `created_at`, `updated_at`   | `TEXT NOT NULL`                                            |

Index : `song_requests_status_created(status, created_at)` et `song_requests_user(user_id)`. `cover_url` vient toujours du cache de propositions, jamais du client. Les mutations admin écrivent `request_accept` et `request_delete` dans `admin_events`.

Sans session : 401 `session_required` (ou `session_expired`). Session sans le groupe admin sur `/api/admin/*` : 403 `admin_required`. Toute autre route `/api/*` : 404 `not_found`. Les routes de métadonnées ne sont montées que si le serveur a un moteur de recherche (toujours le cas via `main.ts`).

## Performance

| Poste               | Choix                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fond WebGL          | 30 i/s à la demande, pause quand l'onglet est caché, uniforms mutés sans React, chunk différé (`React.lazy`).                                                                                                              |
| Flou d'arrière-plan | Seules les cartes ont un `backdrop-filter` ; les boutons à l'intérieur n'en ont plus (même rendu, un calque de flou en moins chacun). En mode visualiseur agrandi, plus aucun flou et le reste de l'interface est démonté. |
| Visualiseur         | Un seul `fill()` par image, taille suivie par `ResizeObserver`, `requestAnimationFrame` annulé au démontage.                                                                                                               |
| Animations          | `LazyMotion` + composants `m`, fonctionnalités chargées à la demande (`lib/motion-features.ts`).                                                                                                                           |
| Images              | Dimensions explicites, `decoding="async"`, `loading="lazy"` dans la file d'attente.                                                                                                                                        |
| Pré-chargement      | Un second élément audio charge le titre suivant pendant la lecture ; au changement de piste les deux éléments sont échangés, sans dépendre du cache HTTP.                                                                  |

## Chorégraphie d'un changement de piste

Constantes dans `lib/transitions.ts`. Ordre garanti : fond, puis carte, puis notification.

| Instant | Élément       | Détail                                                                                        |
| ------- | ------------- | --------------------------------------------------------------------------------------------- |
| 0 ms    | Gradient      | Fondu de couleurs sur 1000 ms (`useSongGradient`, interpolation RVB à ~30 i/s).               |
| 150 ms  | Carte lecteur | Pochette, titre et artiste sortent puis entrent (350 ms).                                     |
| 450 ms  | Notification  | `NotificationManager` retarde la notification de piste ; un second skip annule la précédente. |

Côté moteur, si le titre suivant est déjà pré-chargé, `MusicManager` échange l'élément audio actif et l'élément de pré-chargement au lieu de recharger la source ; le changement est donc quasi instantané.

## Media Session et reprise

- Media Session : `navigator.mediaSession` expose le titre, l'artiste, l'album et la pochette du titre courant, l'état de lecture, la position, et les actions lecture, pause, précédent, suivant et déplacement (`lib/media-session.ts`). Les touches multimédia et l'écran de verrouillage pilotent donc le lecteur.
- Reprise : `lib/resume-state.ts` enregistre le titre et la position dans `localStorage` sous la clé `player.resume.v1` (toutes les 2 s). Au chargement, le lecteur se replace sur ce titre, en pause. L'état est ignoré au-delà de 30 jours ou si le titre a disparu du catalogue ; une position sous 5 s redémarre le titre à 0.

## Événements

```
<audio> play/pause/timeupdate/ended ─┐
QueueManager.onUpdate ───────────────┼─► MusicManager.emit(PlayerEvent)
                                     │        ├─► usePlaybackState (vues)
                                     │        ├─► NotificationManager ─► SongNotificationProvider
                                     │        └─► MusicPlayer (re-rendu)
Clavier ─► ShortcutManager ─┐
Boutons ────────────────────┴─► PlaybackController ─► MusicManager / QueueManager
```

## Raccourcis clavier

Actifs uniquement quand aucun élément n'a le focus.

| Touche | Action                             |
| ------ | ---------------------------------- |
| Espace | Lecture / pause                    |
| ↑ / ↓  | Piste précédente / suivante        |
| ← / →  | Reculer / avancer de 5 s           |
| M      | Afficher / masquer le mini-lecteur |

## Développement

`yarn dev` lance trois processus : Vite (`http://localhost:3000`, qui proxifie `/api` vers l'API), l'API (`http://localhost:8080`, configurée par `.env.development`) et un fournisseur OIDC factice (`http://localhost:3002`, `server/dev/mock-oidc.ts`). Le navigateur ne parle qu'à `:3000` : `APP_URL` vaut donc `http://localhost:3000` et le callback OIDC revient par le proxy.

Pour tester la connexion, ouvrir `http://localhost:3000/api/auth/login` puis se connecter avec l'un des comptes (n'importe quel mot de passe) :

| Compte        | Groupes     |
| ------------- | ----------- |
| `admin@test`  | `["admin"]` |
| `user@test`   | `["users"]` |
| `nobody@test` | `[]`        |

`GET /api/session` renvoie ensuite le rôle déduit des groupes.

Quand `DEV_BYPASS_LOGIN=true` (activé dans `.env.development`), l'écran de connexion de test propose « Entrer en admin » et « Entrer en user », qui ouvrent une session sans passer par le fournisseur OIDC, avec les identités `dev-admin` / `dev-user` (émetteur `dev-bypass`). Ces sessions ne sont pas revérifiées auprès du fournisseur. Le serveur refuse de démarrer si `DEV_BYPASS_LOGIN=true` avec `NODE_ENV=production`.

Le fournisseur factice expose des routes de contrôle : `GET /mock/accounts` liste l'état des comptes, et `POST /mock/accounts/:id` avec un corps JSON `{ "groups": [...], "disabled": true }` modifie les groupes ou désactive un compte (le prochain rafraîchissement de session échoue). Exemple :

```sh
curl -X POST localhost:3002/mock/accounts/user@test -H 'content-type: application/json' -d '{"groups":["admin"]}'
```

`.env.development` est versionné : il ne contient aucun secret réel (clé de session et client OIDC propres au développement). Le dossier `.data/` (données de l'API) est ignoré par git.
