# Plan : diffusion audio (cache, FLAC, variante allégée)

Spec : `docs/superpowers/specs/2026-10-28-diffusion-audio-design.md` (contraignante). Branche `feat/audio-delivery` (base `feat/request-cycle`). Conventions du dépôt (TypeScript strict, `.ts` dans les imports serveur, Bun pour `tests/unit`, `node --test` pour `server/test`, textes UI en français, commits sans attribution, `yarn validate` vert à chaque commit). Tâches 1 et 3 parallèles ; 2 après 1 ; 4 après 2 et 3.

### Task 1 : cache HTTP, transcodage, migration

**Files:** Modify `server/src/routes/media.ts`, `server/src/http-range.ts` (ou nouveau `server/src/http-cache.ts` : `etagMatches(header, etag)`, `httpDate(ms)`), `server/src/media/storage.ts` (`variantPath`), `server/src/migrations.ts` (migration 8), `server/src/catalog/types.ts`, `server/src/catalog/tracks.ts` (colonnes, `hasLight`, `updateTrackVariant`, `convertTrackFormat`), `lib/catalog.ts` (`TrackDto.hasLight`), `server/test/media-routes.test.ts`, `server/test/db.test.ts` ; Create `server/src/media/transcode.ts`, `server/test/transcode.test.ts`.

- [ ] Selon la spec. Les tests existants de `media-routes` restent verts (ajouter les nouveaux cas ; `?q=light` sans variante sert l'original).
- [ ] Commit `Cache media responses and add the ffmpeg transcoders`.

### Task 2 : ingestion, passe d'optimisation, routes

**Files:** Modify `server/src/media/ingest.ts` (`convertWav` seam), `server/src/admin/imports.ts` (passe, auto-démarrage, `optimizeStatus`, `startOptimize`, seams `convertWav`/`encodeAac`), `server/src/app.ts`, `server/src/main.ts`, `server/test/helpers.ts` (seams factices par défaut : conversion et encodage désactivés, pilotables), `server/test/ingest.test.ts` (ou le fichier d'ingest existant), `server/test/admin-imports.test.ts` si besoin ; Create `server/src/routes/admin-media.ts`, `server/test/admin-media.test.ts`.

- [ ] Selon la spec. Le test réel `ffmpeg` est sauté si le binaire est absent.
- [ ] Commit `Convert WAV uploads to FLAC and prepare the light variants`.

### Task 3 : qualité côté client

**Files:** Create `lib/quality.ts`, `tests/unit/quality.test.ts` ; Modify `lib/catalog.ts` (`mediaUrl(id, quality?)`), `lib/music-manager.ts` (`setQuality`, URL résolue, vidage du standby), `components/player.tsx` (bouton « Qualité : … », application au montage et au changement), `tests/unit/catalog.test.ts`.

- [ ] Selon la spec. Vérifier au navigateur (stack de dev, bypass) : le bouton défile, la valeur survit au rechargement, le titre suivant se charge avec `?q=light` en « Allégée » (onglet réseau ou `performance.getEntriesByType("resource")`).
- [ ] Commit `Add the playback quality setting`.

### Task 4 : administration, e2e, docs

**Files:** Modify `lib/admin-api.ts`, `components/admin/admin-panel.tsx`, `docs/architecture.md`, `docs/ci.md`, `README.md` ; Create `components/admin/media-status.tsx`, `lib/hooks/use-media-status.ts`, `tests/e2e/quality.spec.ts`.

- [ ] Ligne de statut et bouton selon la spec ; vérifier au navigateur avec le bypass admin (le serveur de dev a ffmpeg : lancer la passe et voir les compteurs évoluer, puis constater `stream.m4a` dans `.data/dev/media/<id>/`).
- [ ] E2E `quality.spec.ts` selon la spec ; lancer la suite sur une copie temporaire de la config (ports 3014 / `.data/e2e-tmp`), puis nettoyer.
- [ ] Docs. `yarn validate` vert ; commit `Add the media optimisation status to the admin panel and document the delivery`.
