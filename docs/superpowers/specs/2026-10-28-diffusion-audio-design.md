# Diffusion audio : cache, FLAC et variante allégée — design

Base : `feat/request-cycle`. Objectif : une lecture fluide sur ordinateur (qualité maximale, zéro retéléchargement) et sur mobile (variante allégée), sans dégrader la qualité des originaux.

## Cache HTTP (serveur)

- `GET|HEAD /api/media/:trackId` : un titre ne change jamais sous un même id (le fichier stocké est remplacé uniquement par la conversion WAV → FLAC, qui change le `format`). En-têtes : `Cache-Control: private, max-age=31536000, immutable`, `ETag: "<sha256>:<variante>"` (fort ; `variante` = `track.format` pour l'original, `aac` pour la variante allégée), `Last-Modified` (mtime du fichier, format HTTP-date), `Accept-Ranges: bytes`, `Content-Type`.
- `If-None-Match` contenant l'ETag courant (liste séparée par des virgules, `*` accepté) → `304` sans corps, avec `ETag` et `Cache-Control`. Les requêtes `Range` avec `If-None-Match` qui correspond répondent aussi `304`.
- `If-Range` présent : si sa valeur n'est pas l'ETag courant, l'en-tête `Range` est ignoré (réponse `200` complète). Une date dans `If-Range` est traitée comme une non-correspondance (toujours `200`).
- Le flux reste `createReadStream(file, { start, end })` → `Readable.toWeb`, avec `highWaterMark: 256 * 1024`.
- Pochettes (`/:trackId/cover`) : `Cache-Control: private, max-age=31536000, immutable` quand la requête porte `?v=` (l'URL change avec `updatedAt`), sinon inchangé (`private, max-age=300`).
- Le middleware global qui pose `Cache-Control: no-store` sur `/api/*` ne s'applique qu'en l'absence d'en-tête : rien à changer.

## Variante allégée (serveur)

- Paramètre `?q=light` sur `GET|HEAD /api/media/:trackId`. Si la variante AAC existe (`tracks.aac_size_bytes IS NOT NULL` **et** fichier présent), on sert `stream.m4a` avec `Content-Type: audio/mp4`, mêmes règles de cache (ETag `"<sha256>:aac"`). Sinon l'original est servi (repli silencieux). Toute autre valeur de `q`, ou son absence, sert l'original.
- Fichier : `<DATA_DIR>/media/<trackId>/stream.m4a`. `MediaStorage` gagne `variantPath(trackId): string` (toujours `stream.m4a`). Il est supprimé avec le dossier du titre (`removeTrack`, entretien) : rien à ajouter côté entretien.
- Encodage : `ffmpeg -nostdin -hide_banner -y -i <original> -vn -map_metadata -1 -c:a aac -b:a 192k -movflags +faststart -f mp4 <scratch>` puis `rename` vers `stream.m4a`. Le fichier de sortie est écrit dans `storage.scratchPath(trackId)` ; en cas d'échec le scratch est supprimé. Délai 10 min. Module `server/src/media/transcode.ts` : `encodeAac(src, dest, opts)` et `convertWavToFlac(src, dest, opts)` (`ffmpeg -nostdin -hide_banner -y -i <src> -vn -map_metadata 0 -c:a flac -compression_level 5 -f flac <dest>`), tous deux `Promise<boolean>` (jamais d'exception : `false` et log `transcode.failed { kind, name, code }` ; ENOENT → `false` et log `transcode.unavailable` une fois par processus), `run` injectable comme dans `loudness.ts`, `ffmpegPath` de la config.
- Migration `id: 8` : `ALTER TABLE tracks ADD COLUMN aac_size_bytes INTEGER; ALTER TABLE tracks ADD COLUMN aac_attempted_at TEXT;` (`aac_attempted_at` NULL = jamais tenté ; `aac_size_bytes` NULL avec `aac_attempted_at` non NULL = échec). `TrackRecord` : `aacSizeBytes: number | null`, `aacAttemptedAt: Date | null` ; `TrackDto` expose `hasLight: boolean` (`aacSizeBytes !== null`). `updated_at` n'est **pas** modifié par la variante ni par la conversion (il pilote le cache des pochettes).
- Helper `updateTrackVariant(db, id, sizeBytes | null, at)` et `convertTrackFormat(db, id, format: "flac", sizeBytes)` dans `server/src/catalog/tracks.ts`.

## Conversion WAV → FLAC

- À l'import (`ingestFile`) : après la sonde et la mesure de loudness, si `probe.format === "wav"` et qu'un convertisseur est fourni (`input.convertWav?: (file: string, dest: string) => Promise<boolean>`), on convertit vers `<incomingDir>/converted.flac` ; succès → le fichier publié est le FLAC, `format: "flac"`, `sizeBytes` = taille du FLAC (`stat`) ; échec → le WAV est publié tel quel. `sha256` reste celui du fichier **déposé** (la déduplication porte sur ce que l'admin envoie). `durationMs` et les tags viennent de la sonde du WAV. La conversion est sans perte ; le WAV n'embarque ni tags ni pochette exploitables.
- Pour le catalogue existant : la passe d'optimisation (ci-dessous) convertit les titres `format = 'wav'` : encodage vers `scratchPath`, vérification `sniffFormat` = `flac`, `rename` vers `original.flac`, puis `convertTrackFormat`, puis `rm` de `original.wav`. L'ordre garantit qu'un lecteur en cours (flux ouvert sur l'ancien inode) n'est pas coupé et qu'une panne entre deux étapes laisse soit l'ancien état complet, soit le nouveau. La loudness mesurée n'est pas remesurée (identique).

## Passe d'optimisation (serveur)

- Même mécanique que le rattrapage de loudness (paresseuse, un titre à la fois sur la chaîne sérialisée des imports, un titre en cours n'est jamais repris, une seule passe à la fois). Candidats : `status = 'ready' AND (format = 'wav' OR aac_attempted_at IS NULL)`, ordre `created_at, rowid`. Une étape : conversion WAV si besoin, puis variante AAC si `aac_attempted_at IS NULL` (succès → `aac_size_bytes` = taille ; échec → `aac_size_bytes = NULL`) ; dans les deux cas `aac_attempted_at = now`. Un WAV dont la conversion échoue n'est pas repris dans la même passe (ensemble `skipped` en mémoire de la passe) pour éviter de boucler.
- Démarrage : `POST /api/admin/media/optimize` (admin) → `202 { queued, running }` ; `409 ffmpeg_unavailable` si ffmpeg absent (même cache que la loudness). Événement `admin_events` `media_optimize { queued }` quand une passe démarre. **Démarrage automatique** : après chaque import réussi (`run()` → `ready`), la passe est lancée si elle ne tourne pas déjà et si ffmpeg est disponible ; aucun événement admin dans ce cas.
- `GET /api/admin/media/optimize` → `{ total, light, failed, pending, wav, running, available }` (`light` = `aac_size_bytes IS NOT NULL` ; `failed` = tenté sans variante ; `pending` = `aac_attempted_at IS NULL` ; `wav` = `format = 'wav'`).
- Tout ce bloc vit dans `createImportQueue` (`server/src/admin/imports.ts`) à côté du rattrapage de loudness, avec les seams de test `convertWav`, `encodeAac` injectables (par défaut `transcode.ts`). `ImportQueue` expose `optimizeStatus()` et `startOptimize()`.
- `/api/admin/health` : aucun changement.

## Client

- Réglage `player.quality.v1` en `localStorage` : `"auto" | "max" | "light"`, défaut `auto` ; module pur `lib/quality.ts` : `parseQualitySetting(raw)`, `resolveQuality(setting, env): "max" | "light"` où `env = { saveData: boolean; effectiveType: string | null; coarsePointer: boolean; viewportWidth: number }` ; en `auto` → `light` si `saveData`, ou `effectiveType ∈ {slow-2g, 2g, 3g}`, ou (`coarsePointer` et `viewportWidth ≤ 768`) ; sinon `max`. `readQualityEnv()` lit `navigator.connection`, `matchMedia("(pointer: coarse)")`, `window.innerWidth`. `mediaUrl(id, quality?)` ajoute `?q=light` quand `quality === "light"`.
- `MusicManager.setQuality(q: "max" | "light")` : mémorise la qualité ; l'URL chargée dans un élément est `mediaUrl(song.id, quality)` (`setPlaying`, pré-chargement, comparaison `standbyUrl`). Un changement de qualité s'applique au prochain titre chargé ; le titre en cours continue. Si la qualité change alors qu'un titre est en attente dans `standby`, le `standby` est vidé (`standbyUrl = null`) pour que le pré-chargement reparte avec la bonne URL.
- Interface : sous la liste, à côté de « Demander un son », un bouton texte `ghost` « Qualité : Auto » / « Qualité : Max » / « Qualité : Allégée » qui fait défiler Auto → Max → Allégée → Auto, `aria-label` « Qualité de lecture : <valeur> », `data-quality-button`. Persistance immédiate ; la valeur résolue est appliquée via `setQuality` à chaque changement et au montage. En mode focus et dans la fenêtre « Demander un son », le bouton n'est pas affiché.

## Administration

- Sous la ligne « Volume : … » (onglet Catalogue), une ligne « Lecture allégée : n titres sur m prêts » avec le bouton « Préparer les titres restants » (désactivé si `pending = 0 && wav = 0`, ou `available = false`, ou `running`) ; « n titres WAV à convertir » si `wav > 0` ; « n titres sans variante » si `failed > 0` ; « ffmpeg introuvable sur le serveur » si `!available`. Même politique de rafraîchissement que la loudness (2 s tant que `running`). Composant `components/admin/media-status.tsx`, hook `lib/hooks/use-media-status.ts`, client `lib/admin-api.ts` (`getMediaStatus`, `startMediaOptimize`).

## Tests

- `node --test` : `transcode.ts` avec `run` factice (arguments exacts, succès, ENOENT, code ≠ 0, timeout) ; migration 8 ; routes média : `ETag`/`Cache-Control`/`Last-Modified`, `304` sur `If-None-Match` (exact, liste, `*`, avec `Range`), `If-Range` égal → `206`, différent → `200`, `?q=light` avec variante (type `audio/mp4`, ETag `:aac`) et sans variante (repli) ; ingest : conversion WAV factice réussie (format `flac`, sha du WAV, taille du FLAC) et échouée (WAV publié) ; passe d'optimisation : statut, `202`/`409`, auto-démarrage après import, conversion WAV d'un titre existant (fichier, ligne, ancien fichier supprimé), échec d'encodage → `failed`, titre supprimé pendant la passe ignoré ; une intégration réelle `ffmpeg` sautée (`t.skip`) si absent : WAV 1 s → FLAC sniffé, AAC lisible par `music-metadata`.
- Bun : `parseQualitySetting`, `resolveQuality` (toutes les branches), `mediaUrl` avec qualité.
- E2E (`tests/e2e/quality.spec.ts`) : le bouton fait défiler les trois valeurs, la valeur survit à un rechargement, et la lecture démarre en « Allégée » (le flux répond `206` ou `200`, titre affiché). Les fixtures e2e sont des WAV : avec ffmpeg sur la machine, elles sont converties en FLAC à l'import ; les scénarios existants ne dépendent pas de l'extension stockée.
- `yarn validate` et la suite e2e restent verts.

## Documentation

- `docs/architecture.md` : cache HTTP, ETag, variante allégée, conversion WAV, passe d'optimisation, note proxy inverse (laisser passer `Range`, `If-None-Match`, `If-Range` ; ne pas mettre en cache côté proxy : réponses `private`).
- `docs/ci.md` / `README.md` : après déploiement, cliquer « Préparer les titres restants » (ou attendre : la passe démarre d'elle-même au premier import).
