# Incréments 2 et 3 : catalogue serveur, médias privés, panel admin — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le catalogue (dossiers, titres, médias, pochettes) vit sur le serveur dans `DATA_DIR` et n'est servi qu'aux sessions valides ; les admins l'alimentent et l'organisent depuis le panneau d'administration (import par glisser-déposer, dossiers, édition, suppression, recherche de métadonnées).

**Architecture:** Nouvelles tables SQLite (`folders`, `tracks`, `imports`, `admin_events`, `favorites`), un module de stockage qui ne connaît que des identifiants opaques, un pipeline d'import asynchrone en processus, des routes `/api/catalog`, `/api/media/*` et `/api/admin/*` derrière `requireSession`/`requireAdmin`, un client API typé côté React et un panneau admin en trois zones. Le lecteur consomme `/api/catalog` à la place de `music/data.json`.

**Tech Stack:** existant (Node 24, Hono 4.13, `node:sqlite`, React 19, Tailwind 4, Playwright, Bun) + `music-metadata` 12.3 (déjà présent) + `busboy` 1.6.0 (multipart en flux) + `node-id3` 0.2.9 (tags MP3) + `metaflac-js` 1.1.0 (tags FLAC). Identifiants : `crypto.randomUUID()`.

**Spec:** `docs/superpowers/specs/2026-10-26-plateforme-serveur-et-oidc-design.md` §5.2, §5.3, §5.4, §5.6, §5.7, §5.8, §5.9 (panel), §7, §8 (incréments 2 et 3). Base : branche issue de l'incrément 1 (commit `5acbc16` ou son successeur après la vague de correctifs).

## Global Constraints

- Tout ce qui existe déjà : TypeScript serveur effaçable, erreurs JSON `{ error: { code, message } }`, en-tête `X-Requested-With: player` sur toute mutation, `requireSession` construit une seule fois dans `createApp` et réutilisé, logs sans secret, commits anglais impératifs sans trailer.
- Aucun chemin de fichier ne vient du client. Disposition : `DATA_DIR/media/<trackId>/original.<ext>`, `DATA_DIR/media/<trackId>/cover.<ext>`, `DATA_DIR/incoming/<importId>/`.
- Formats acceptés par signature : FLAC (`fLaC`), MP3 (en-tête `ID3` ou trame MPEG `0xFFEx`/`0xFFFx`), WAV (`RIFF….WAVE`). Extension stockée : `flac`, `mp3`, `wav`. `MAX_UPLOAD_MB` (défaut 200) appliqué en flux : au-delà, import `failed: too_large` et fichier temporaire supprimé.
- `sha256` = empreinte du fichier tel que stocké ; unique sur `tracks` ; recalculée après réécriture de tags. Doublon à l'import → `failed: duplicate` avec `trackId` existant.
- `tracks.folder_id` nul = boîte d'arrivée. Un titre est dans un seul dossier. `position` entière, renumérotée par dossier après chaque mouvement (0..n-1).
- Dossiers : unicité `(parent_id, name)`, déplacement vers un descendant refusé `400 folder_cycle`, suppression d'un dossier non vide refusée `409 folder_not_empty` sauf `?force=1` qui remonte le contenu dans le parent, lequel refuse `409 folder_conflict` si un homonyme existe.
- Médias : `GET`/`HEAD` avec `Range` (206, `Content-Range`, 416 si hors plage), `Accept-Ranges: bytes`, `Content-Type` par extension (`audio/flac`, `audio/mpeg`, `audio/wav`), `Cache-Control: private, no-store` pour l'audio, `private, max-age=300` pour les pochettes ; rôle `user` ou `admin` requis.
- Métadonnées externes : requêtes côté serveur uniquement, `User-Agent: SheldonPlayer/1.0 (+${APP_URL})`, au plus 1 requête/s/fournisseur, 5 s de délai maximal, propositions en cache 15 min avec `proposalId` opaque, téléchargement de pochette limité aux hôtes des fournisseurs, 2 redirections max vers ces hôtes, IP privées refusées, 5 Mio max, type vérifié par signature (JPEG/PNG/WebP).
- Interface admin : même verre que la scène (`bg-purple-950/25`, bordure `purple-100/10`, sans blur), typographie Inter, textes français sans tiret cadratin, composants `m.*` uniquement, aucune modification de la disposition du lecteur hors ce qui est listé.
- Toute route `/api/admin/*` passe par `requireSession` puis `requireAdmin` ; chaque mutation admin écrit une ligne `admin_events`.

## Review Focus

1. Un fichier `.mp3` dont le contenu est en réalité un MP4/AAC ou un texte : attendu `failed: unsupported_format`, aucune ligne `tracks`, dossier `incoming/<importId>` nettoyé. Test en Task 3.
2. Deux imports simultanés du même fichier : attendu un seul `tracks`, le second `failed: duplicate` avec le `trackId` du premier (contrainte d'unicité `sha256` + transaction). Test en Task 8.
3. Une requête `Range: bytes=0-` sur un FLAC de 60 Mio par un `user` : attendu 206 en flux (pas de lecture complète en mémoire), `Content-Length` exact ; la même requête sans session → 401 sans aucun octet du média. Test en Task 4.
4. Suppression d'un titre en cours de lecture chez un autre utilisateur : attendu que la file du lecteur se mette à jour au prochain `GET /api/catalog` (rafraîchi toutes les 60 s et après chaque action admin dans le même navigateur), sans erreur non gérée si `GET /api/media/:id` renvoie 404 ; le lecteur passe au titre suivant. Test en Task 7 (lecteur) et Task 9 (serveur 404 après suppression).
5. Un `PATCH /api/admin/tracks/:id` avec `folderId` inexistant ou `position` négative : attendu `400 bad_request`, aucun changement. Test en Task 9.

---

### Task 1 : Migration 2 — tables du catalogue

**Files:** Modify `server/src/migrations.ts` ; Test `server/test/db.test.ts`.

**Interfaces:** migration `id: 2` :

```sql
CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(parent_id, name));
CREATE TABLE tracks (id TEXT PRIMARY KEY, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '', album TEXT NOT NULL DEFAULT '', duration_ms INTEGER, format TEXT NOT NULL CHECK (format IN ('flac','mp3','wav')), size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE, cover_ext TEXT, status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','failed')), position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX tracks_folder_position ON tracks(folder_id, position);
CREATE TABLE imports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('processing','ready','failed')), error TEXT, track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE admin_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, track_id TEXT, folder_id TEXT, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE favorites (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY (user_id, track_id));
```

- [ ] Test : `migrate` sur une base vierge retourne `2` ; insérer un `tracks` avec `format 'ogg'` lève une erreur de contrainte ; deux `folders` de même `name` sous le même parent lèvent une erreur ; deux de même nom sous des parents différents passent.
- [ ] Échec, implémentation, succès, commit `Add catalogue tables`.

### Task 2 : Dépôt du catalogue

**Files:** Create `server/src/catalog/folders.ts`, `server/src/catalog/tracks.ts`, `server/src/catalog/types.ts` ; Test `server/test/catalog-repo.test.ts`.

**Interfaces:**

```ts
export interface FolderRecord { id: string; parentId: string | null; name: string; position: number }
export interface TrackRecord { id: string; folderId: string | null; title: string; artist: string; album: string; durationMs: number | null; format: "flac" | "mp3" | "wav"; sizeBytes: number; sha256: string; coverExt: string | null; status: "ready" | "failed"; position: number; createdAt: Date; updatedAt: Date }
// folders.ts
export function listFolders(db): FolderRecord[]                      // triés parent puis position
export function createFolder(db, input: { parentId: string | null; name: string }, now): FolderRecord   // position = max+1 dans le parent ; lève FolderConflictError si homonyme
export function renameFolder(db, id, name, now): FolderRecord          // FolderConflictError, NotFoundError
export function moveFolder(db, id, parentId: string | null, now): FolderRecord  // FolderCycleError si parentId est id ou un descendant
export function deleteFolder(db, id, opts: { force: boolean }): void   // FolderNotEmptyError sans force ; avec force : titres et sous-dossiers remontés dans le parent (FolderConflictError si homonyme), renumérotation
export function isDescendant(folders: FolderRecord[], candidateId, ancestorId): boolean  // pur, testé
// tracks.ts
export function listTracks(db): TrackRecord[]                          // status 'ready', triés folder_id, position
export function getTrack(db, id): TrackRecord | null
export function findTrackBySha(db, sha256): TrackRecord | null
export function insertTrack(db, input: Omit<TrackRecord, "createdAt" | "updatedAt" | "position">, now): TrackRecord  // position = max+1 du dossier
export function updateTrack(db, id, patch: Partial<Pick<TrackRecord, "title" | "artist" | "album" | "coverExt" | "sha256" | "sizeBytes">>, now): TrackRecord
export function moveTrack(db, id, folderId: string | null, position: number | undefined, now): TrackRecord  // renumérote l'ancien et le nouveau dossier
export function deleteTrack(db, id): void                              // supprime favoris par cascade, renumérote
export function renumber(db, folderId: string | null): void
export class NotFoundError / FolderConflictError / FolderCycleError / FolderNotEmptyError extends Error { code: string }
```

- [ ] Tests : création/renommage/conflit ; cycle refusé (A→B→C puis move A sous C) ; suppression non vide refusée puis `force` remonte titres et sous-dossiers et renumérote ; `moveTrack` renumérote 0..n-1 des deux côtés ; `insertTrack` deux fois même `sha256` lève une erreur d'unicité.
- [ ] Échec, implémentation, succès, commit `Add catalogue repository for folders and tracks`.

### Task 3 : Stockage média et analyse de fichier

**Files:** Create `server/src/media/storage.ts`, `server/src/media/probe.ts`, `server/test/media-probe.test.ts`, `server/test/fixtures/` (générer à l'exécution des tests : un WAV valide de 1 s écrit par le test, un MP3 minimal valide (trame silencieuse de quelques Ko encodée en base64 dans le test), un fichier texte renommé `.mp3`) ; Modify `server/src/config.ts` (`maxUploadBytes` depuis `MAX_UPLOAD_MB`, défaut 200).

**Interfaces:**

```ts
// probe.ts
export type AudioFormat = "flac" | "mp3" | "wav";
export function sniffFormat(head: Buffer): AudioFormat | null; // 12 premiers octets suffisent
export interface ProbeResult {
  format: AudioFormat;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  cover: { data: Buffer; ext: "jpg" | "png" | "webp" } | null;
  sha256: string;
  sizeBytes: number;
}
export async function probeFile(path: string): Promise<ProbeResult>; // sniff + music-metadata parseFile + hash en flux ; lève UnsupportedFormatError
// storage.ts
export function createMediaStorage(dataDir: string): MediaStorage;
export interface MediaStorage {
  incomingDir(importId: string): string; // créé
  removeIncoming(importId: string): Promise<void>;
  publish(
    importId: string,
    trackId: string,
    file: string,
    ext: AudioFormat,
    cover: ProbeResult["cover"],
  ): Promise<void>; // mkdir media/<trackId>, rename atomique de l'original puis écriture de la pochette, nettoyage incoming
  originalPath(trackId, ext): string;
  coverPath(trackId, ext): string;
  writeCover(trackId, data: Buffer, ext): Promise<void>;
  removeTrack(trackId): Promise<void>;
}
```

- [ ] Tests : `sniffFormat` sur les trois signatures et sur `%PDF` → null ; `probeFile` du WAV généré → `format wav`, `durationMs` ≈ 1000, `sha256` 64 hex ; du faux `.mp3` texte → `UnsupportedFormatError` (Review Focus 1) ; `publish` crée `media/<id>/original.wav`, supprime `incoming/<importId>` ; `removeTrack` supprime le dossier.
- [ ] Échec, implémentation, succès, commit `Add media storage and audio probing`.

### Task 4 : Routes catalogue et médias

**Files:** Create `server/src/routes/catalog.ts`, `server/src/routes/media.ts`, `server/src/http-range.ts` ; Modify `server/src/app.ts` (dépendances `storage`, montage) ; Test `server/test/catalog-routes.test.ts`, `server/test/media-routes.test.ts`.

**Interfaces:**

- `GET /api/catalog` (session + rôle) → `200 { folders: FolderNode[]; tracks: TrackDto[] }` avec `FolderNode { id, name, position, children: FolderNode[] }` et `TrackDto { id, folderId, title, artist, album, durationMs, format, hasCover: boolean, position }`. En-tête `Cache-Control: private, no-store`.
- `GET|HEAD /api/media/:trackId` : 404 si inconnu/`failed` ; `parseRange(header, size): { start, end } | null | "unsatisfiable"` (pur, testé : `bytes=0-`, `bytes=100-199`, `bytes=-500`, `bytes=5-2` → unsatisfiable, multi-plages → première plage seulement) ; réponse en flux `fs.createReadStream` ; 206 + `Content-Range: bytes s-e/size` ; 416 + `Content-Range: bytes */size` ; `Accept-Ranges`, `Content-Type`, `Content-Length` exacts ; `HEAD` sans corps.
- `GET /api/media/:trackId/cover` : 404 sans pochette ; `Content-Type` par extension ; `Cache-Control: private, max-age=300`.
- [ ] Tests (fixtures créées par Task 3, insérées via le dépôt) : anonyme → 401 et aucun octet ; `user` → 200 complet, 206 sur `bytes=0-99` (100 octets, `Content-Range` exact), 416, `HEAD` 200 avec `Content-Length` ; `admin` → 200 ; track inconnu → 404 ; `/api/catalog` → arbre et titres triés. (Review Focus 3.)
- [ ] Échec, implémentation, succès, commit `Serve the catalogue and private media`.

### Task 5 : Script de migration du catalogue existant

**Files:** Create `server/src/migrate-catalog.ts` (entrée CLI : `node dist/server/migrate-catalog.js <dossier-source> [--manifest music/data.json]`) ; Test `server/test/migrate-catalog.test.ts` ; Modify `package.json` (`"migrate:catalog": "node --no-warnings=ExperimentalWarning server/src/migrate-catalog.ts"`), `docs/ci.md` (section Migration).

**Interfaces:** `migrateCatalog({ db, storage, sourceDir, manifest?: { name, author, url, picture?, folder? }[] , now }): Promise<{ imported: number; skipped: number; failed: { file: string; reason: string }[] }>` : pour chaque fichier audio du dossier source (récursif), `probeFile` ; doublon `sha256` → `skipped` ; dossier = entrée `folder` du manifeste dont `url` correspond au nom de fichier, sinon le sous-dossier source, sinon racine ; crée les dossiers manquants ; titre/artiste du manifeste priment sur les tags ; pochette : fichier `picture` du manifeste s'il existe, sinon pochette embarquée ; `position` = ordre du manifeste puis ordre alphabétique.

- [ ] Test : dossier temporaire avec le WAV de fixture + manifeste à un titre et un dossier « Chill » → `imported 1`, dossier créé, deuxième exécution → `skipped 1`, `imported 0`.
- [ ] Échec, implémentation, succès, commit `Add the catalogue migration script`.

### Task 6 : Client API catalogue et lecteur branché sur le serveur

**Files:** Create `lib/catalog.ts` (`fetchCatalog(): Promise<Catalog>`, types `Catalog`, `FolderNode`, `TrackDto`, `mediaUrl(id)`, `coverUrl(id)`), `lib/hooks/use-catalog.ts` ; Modify `music/data.d.ts` → remplacé par `lib/catalog.ts` types (`Song` devient `{ id: string; name: string; author: string; album: string; url: string; picture?: string; folderId: string | null; folderPath: string[] }`), `lib/storage-manager.ts` (supprimé : plus de `custom_songs`), `lib/queue-manager.ts` (`QueueItem` = `Song` avec `id` string ; `getTrackDirection` inchangé ; ordre = ordre du catalogue aplati : dossiers dans l'ordre de l'arbre, titres par position), `lib/music-manager.ts` (`setSongs` appelé par le lecteur quand le catalogue arrive ; conserve le titre courant par `id` lors d'un rafraîchissement), `lib/player-runtime.ts`, `components/player.tsx`, `components/song-list.tsx` (arbre imbriqué par `FolderNode`, indentation par niveau, `groupByFolder` remplacé par `flattenCatalog` pur et testé), `components/now-playing.tsx`, `components/up-next.tsx`, `components/song-notification.tsx` (pochette via `coverUrl`), `lib/palette.ts` (l'image est même origine : `crossOrigin` retiré, les cookies suivent), tests Bun (`tests/unit/song-list.test.ts` → `flattenCatalog`, `tests/unit/queue-direction.test.ts` adapté aux ids string).

**Interfaces:** `useCatalog(): { status: "loading" | "ready" | "error"; catalog?: Catalog; refresh(): Promise<void> }` : charge au montage, toutes les 60 s, et expose `refresh` (le panel admin l'appelle après chaque mutation). `flattenCatalog(catalog): Song[]` et `folderPath` calculé.

- [ ] Tests Bun : `flattenCatalog` ordonne dossiers (ordre de l'arbre, profondeur d'abord) puis titres par `position`, racine en dernier ; `getTrackDirection` avec ids string.
- [ ] Implémenter ; le lecteur affiche le catalogue serveur ; `music/data.json` n'est plus importé par le bundle ; la liste affiche les sous-dossiers.
- [ ] `yarn validate` ; commit `Load the catalogue from the API`.

### Task 7 : Retrait des médias publics et e2e sur le catalogue serveur

**Files:** Delete `public/*.mp3`, `public/*.jpg`, `public/*.png` sauf `favicon.ico` et `preview.png` si référencé ; Delete `music/data.json`, `music/generate.mjs`, `music/data.d.ts` ; Modify `package.json` (retirer `generate:music`), `playwright.config.ts` et `scripts/e2e/start-server.sh` (après `rm` du data dir, exécuter `node dist/server/migrate-catalog.js tests/e2e/fixtures` qui contient un WAV court généré et commité (< 100 Ko) et un manifeste JSON), `tests/e2e/player.spec.ts` (le scénario Range devient authentifié sur `/api/media/<id>` : récupérer l'id via `GET /api/catalog`), `tests/e2e/auth.spec.ts` (titre attendu depuis le manifeste de fixtures), `scripts/ci/stack-check.sh` (Range sur `/api/media` impossible sans session : remplacer par `GET /Drops.mp3` → 404 et `GET /api/catalog` → 401), `docs/ci.md`, `README.md`, `docs/architecture.md`.

- [ ] `yarn validate`, `yarn test:e2e` verts ; `curl /Drops.mp3` sur la pile Docker → 404.
- [ ] Commit `Remove public media and serve the catalogue from the data directory`.

### Task 8 : Import asynchrone

**Files:** Create `server/src/admin/imports.ts` (file d'attente en processus), `server/src/routes/admin-imports.ts` ; Modify `server/src/app.ts` ; Test `server/test/admin-imports.test.ts`. Dépendance : `busboy@1.6.0` (exact).

**Interfaces:**

- `POST /api/admin/imports` (multipart, champ `file`, un seul fichier) : écrit en flux dans `incoming/<importId>/upload.bin` en comptant les octets ; au-delà de `maxUploadBytes` → arrêt, suppression, `413 { code: "too_large" }` ; sinon insère `imports(state 'processing')`, met en file, répond `202 { importId }`.
- `createImportQueue({ db, storage, log })` : `enqueue(importId)` ; un ouvrier à la fois ; pour chaque import : `probeFile` → doublon (`findTrackBySha`) → `failed: duplicate` (`error` JSON `{ reason, trackId }`) ; format inconnu → `failed: unsupported_format` ; sinon `insertTrack` (titre = tag ou nom de fichier sans extension, artiste = tag ou `''`, `folder_id` nul) dans une transaction avec `publish`, puis `imports.state 'ready'`, `track_id` ; `admin_events(action 'import')`. Toute exception → `failed: internal` (message journalisé, pas exposé) et nettoyage.
- `GET /api/admin/imports/:id` → `200 { id, filename, state, error, trackId, createdAt }` ; `GET /api/admin/imports?limit=50` → les derniers imports.
- [ ] Tests : upload WAV de fixture → 202, puis après `await queue.idle()` l'import est `ready` avec un `trackId` et le fichier est sous `media/<id>/original.wav` ; faux mp3 → `failed unsupported_format`, `incoming` nettoyé ; deux uploads identiques → un `ready`, un `failed duplicate` avec le même `trackId` (Review Focus 2) ; fichier > limite (config de test `MAX_UPLOAD_MB=1`, fichier de 1,5 Mio) → 413 ; `user` → 403 ; sans en-tête CSRF → 403.
- [ ] Échec, implémentation, succès, commit `Add asynchronous admin imports`.

### Task 9 : Administration des dossiers et des titres

**Files:** Create `server/src/routes/admin-folders.ts`, `server/src/routes/admin-tracks.ts`, `server/src/media/tags.ts` ; Test `server/test/admin-folders.test.ts`, `server/test/admin-tracks.test.ts`, `server/test/tags.test.ts`. Dépendances : `node-id3@0.2.9`, `metaflac-js@1.1.0` (exact).

**Interfaces:**

- `GET /api/admin/folders` → arbre ; `POST /api/admin/folders { name, parentId }` → 201 ; `PATCH /api/admin/folders/:id { name?, parentId?, position? }` ; `DELETE /api/admin/folders/:id?force=1`. Mappage d'erreurs : `FolderConflictError` → 409 `folder_conflict`, `FolderCycleError` → 400 `folder_cycle`, `FolderNotEmptyError` → 409 `folder_not_empty`, `NotFoundError` → 404.
- `PATCH /api/admin/tracks/:id { title?, artist?, album?, folderId?, position? }` : validation (`title` non vide ≤ 200, `folderId` existant ou `null`, `position` entier ≥ 0) sinon `400 bad_request` ; `writeTags(path, format, { title, artist, album }): Promise<boolean>` (MP3 via `node-id3`, FLAC via `metaflac-js`, WAV → `false`) ; après écriture réussie, recalcul `sha256` et `sizeBytes` ; réponse `200 { track, tagsWritten }`.
- `DELETE /api/admin/tracks/:id` → `deleteTrack` + `storage.removeTrack` + `admin_events` → 204 ; ensuite `GET /api/media/:id` → 404 (Review Focus 4).
- `POST /api/admin/tracks/:id/cover` (multipart `file`, image ≤ 5 Mio, signature vérifiée) → remplace la pochette, `200 { hasCover: true }`.
- [ ] Tests : CRUD dossiers avec les quatre codes d'erreur ; `PATCH` titre MP3 de fixture → `tagsWritten true` et `sha256` modifié ; WAV → `tagsWritten false` ; `folderId` inexistant / `position -1` → 400 (Review Focus 5) ; suppression puis 404 média ; `admin_events` contient une ligne par mutation ; `user` → 403 partout.
- [ ] Échec, implémentation, succès, commit `Add admin routes for folders, tracks and covers`.

### Task 10 : Client API admin et panneau — dossiers et titres

**Files:** Create `lib/admin-api.ts` (fonctions typées pour chaque route des Tasks 8-9, `uploadFile(file, onProgress)` via `XMLHttpRequest` pour la progression), `components/admin/admin-panel.tsx` (remplace `components/admin-panel.tsx`), `components/admin/folder-tree.tsx`, `components/admin/track-table.tsx`, `components/admin/track-editor.tsx`, `components/admin/context-menu.tsx`, `lib/hooks/use-admin-catalog.ts` ; Modify `components/player.tsx` (import), `lib/hooks/use-catalog.ts` (le panneau appelle `refresh()` du lecteur après chaque mutation).

**Interfaces / comportement :**

- Disposition dans le panneau existant : colonne gauche (w-64) arbre des dossiers avec « Boîte d'arrivée » en tête (titres sans dossier, compteur) et « Nouveau dossier » (saisie inline, Entrée valide, Échap annule) ; zone centrale tableau des titres du dossier sélectionné (pochette 32 px, titre, artiste, album, durée `mm:ss`, format) ; panneau droit (w-80) éditeur du titre sélectionné (champs titre/artiste/album, bouton « Enregistrer », mention « Tags écrits dans le fichier » ou « Tags non écrits (WAV) » selon `tagsWritten`, pochette avec « Remplacer la pochette »).
- Glisser-déposer HTML5 : une ligne de titre vers un dossier de l'arbre (`dataTransfer` `text/x-track-id`) → `PATCH folderId` ; retour visuel sur le dossier survolé.
- Clic droit sur un titre → menu contextuel (`role="menu"`, positionné au curseur, fermé par Échap/clic extérieur) : « Modifier », « Déplacer vers… » (sous-menu des dossiers), « Rechercher les métadonnées » (Task 12), « Supprimer » (confirmation inline « Supprimer définitivement ? Oui / Non »).
- Menu contextuel sur un dossier : « Renommer », « Supprimer » (si non vide : « Le dossier contient N éléments, les remonter dans le parent ? »).
- Chaque mutation : appel API, puis `refreshAdmin()` et `refreshCatalog()` ; erreurs affichées dans une bannière en haut du panneau (`error.message`), jamais silencieuses.
- Focus : à l'ouverture du panneau, focus sur le premier élément de l'arbre ; à la fermeture, focus rendu au bouton « Administration ».
- [ ] Tests Bun pour les fonctions pures (`buildFolderPathLabel`, tri des titres) ; `yarn typecheck`, `yarn lint`.
- [ ] Commit `Add the admin panel with folders and track management`.

### Task 11 : Panneau — import par glisser-déposer

**Files:** Create `components/admin/upload-zone.tsx`, `lib/hooks/use-import-queue.ts` ; Modify `components/admin/admin-panel.tsx`.

**Comportement :** zone de dépôt permanente en bas de la zone centrale (« Dépose des fichiers FLAC, MP3 ou WAV ici », clic pour ouvrir le sélecteur, `accept=".flac,.mp3,.wav,audio/*"`) ; file côté client, 2 transferts en parallèle, une ligne par fichier avec barre de progression (XHR `upload.onprogress`), puis état serveur sondé toutes les 1 s via `GET /api/admin/imports/:id` jusqu'à `ready`/`failed` ; libellés : « Envoi 42 % », « Analyse… », « Importé » (lien « Voir » sélectionne le titre dans la boîte d'arrivée), « Doublon de <titre> », « Format non reconnu », « Trop volumineux (max N Mo) », « Erreur serveur » ; `refreshCatalog()` à chaque `ready` ; fichiers refusés avant envoi s'ils dépassent `MAX_UPLOAD_MB` (exposé par `GET /api/admin/limits` → `{ maxUploadBytes }`, à ajouter dans `admin-imports.ts`).

- [ ] Test Bun du réducteur de file (`nextTransfers(state)` démarre au plus 2 envois) ; `yarn validate`.
- [ ] Commit `Add drag-and-drop imports to the admin panel`.

### Task 12 : Fournisseurs de métadonnées et identification

**Files:** Create `server/src/metadata/providers.ts` (MusicBrainz + Cover Art Archive, Deezer, iTunes), `server/src/metadata/search.ts` (agrégation, dédoublonnage, cache `proposalId`), `server/src/metadata/fetch-guard.ts` (liste d'hôtes, résolution DNS, IP privées, redirections, taille, type d'image), `server/src/routes/admin-metadata.ts`, `components/admin/metadata-dialog.tsx` ; Test `server/test/metadata-search.test.ts` (fournisseurs simulés par injection de `fetch`), `server/test/fetch-guard.test.ts`, `server/test/admin-metadata.test.ts`.

**Interfaces:**

```ts
export interface Proposal {
  id: string;
  source: "musicbrainz" | "deezer" | "itunes";
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  coverUrl: string | null;
}
export interface MetadataProvider {
  name: Proposal["source"];
  search(q: string, signal: AbortSignal): Promise<Omit<Proposal, "id">[]>;
}
export function createMetadataSearch({ providers, fetch, now, log }): {
  search(q): Promise<Proposal[]>;
  getProposal(id): Proposal | null;
};
export async function guardedFetchImage(
  url: URL,
  opts: { allowedHosts: string[]; maxBytes: number; resolve: (host) => Promise<string[]> },
): Promise<{ data: Buffer; ext: "jpg" | "png" | "webp" }>;
```

- `GET /api/admin/metadata/search?q=` (admin) → `200 { proposals }` (q 2..200 caractères, sinon 400 ; au-delà d'une requête/s/fournisseur, le fournisseur est sauté et `partial: true`).
- `POST /api/admin/tracks/:id/metadata { proposalId, applyCover: boolean }` → applique titre/artiste/album via la logique de Task 9 (tags + sha) et télécharge la pochette via `guardedFetchImage` si demandé ; `404 proposal_expired` si inconnu.
- Dialogue : ouvert par le menu contextuel, champ de recherche prérempli `${titre} ${artiste}` ou le nom de fichier, liste de propositions (pochette, titre, artiste, album, source), case « Appliquer la pochette », bouton « Appliquer », états vide/erreur.
- [ ] Tests : agrégation et dédoublonnage sur réponses simulées ; limite 1 req/s par fournisseur (horloge injectée) ; `guardedFetchImage` refuse un hôte hors liste, une IP privée résolue, une 3e redirection, un corps > 5 Mio, un type non image ; route `POST` applique titre et pochette sur le MP3 de fixture.
- [ ] Échec, implémentation, succès, commit `Add metadata lookup from free providers`.

### Task 13 : E2E administration

**Files:** Modify `tests/e2e/auth.spec.ts` ou Create `tests/e2e/admin.spec.ts` ; fixtures `tests/e2e/fixtures/`.

- [ ] Scénarios : `admin@test` ouvre le panneau, crée le dossier « Test », dépose le WAV de fixture via `setInputFiles` sur l'entrée de la zone de dépôt, voit « Importé », glisse le titre dans « Test » (ou utilise « Déplacer vers… »), ferme le panneau, le titre apparaît dans la file du lecteur sous « Test » ; renomme le titre via l'éditeur ; le supprime avec confirmation ; `user@test` : `GET /api/admin/folders` via `page.request` → 403, aucun bouton « Administration ».
- [ ] `yarn test:e2e` vert ; commit `Add end-to-end scenarios for the admin panel`.

### Task 14 : Documentation, CI, recette

**Files:** Modify `docs/architecture.md` (couches : catalogue, médias, admin, métadonnées ; chorégraphie inchangée), `docs/ci.md` (migration du catalogue en production : `docker compose run --rm -v ./public:/import player node dist/server/migrate-catalog.js /import`, sauvegarde du volume avant), `README.md`, `.env.example` (`MAX_UPLOAD_MB`), `scripts/ci/stack-check.sh` (déjà adapté en Task 7), `.github/workflows/test.yml` si de nouvelles fixtures sont nécessaires.

- [ ] `yarn validate`, `yarn test:e2e`, `actionlint`, `shellcheck` ; commit `Document the catalogue, admin panel and migration`.

## Auto-revue

- Couverture du design : §5.3 tables → T1 ; §5.2/§5.6 dépôt → T2 ; §5.7 import → T3, T8 ; §5.4 routes catalogue/médias → T4, admin → T8, T9, T12 ; §7 migration → T5, T7, T14 ; §5.9 lecteur sur l'API et panneau → T6, T10, T11, T12 ; §5.8 métadonnées + SSRF → T12 ; §6 tests → chaque tâche + T13 ; §8 ordre 2 puis 3 respecté (T1-T7 puis T8-T14).
- Types : `TrackRecord`/`TrackDto`/`Song` nommés une fois ; `FolderNode` partagé serveur/client via `lib/catalog.ts` (types dupliqués côté serveur dans `catalog/types.ts`, à garder alignés : noter dans T4).
- Review Focus : 1 → T3 ; 2 → T8 ; 3 → T4 ; 4 → T7, T9 ; 5 → T9.
- Proportion : interfaces et tests fixés, corps laissés au constructeur ; le choix des bibliothèques de tags est posé (node-id3, metaflac-js) mais remplaçable.
