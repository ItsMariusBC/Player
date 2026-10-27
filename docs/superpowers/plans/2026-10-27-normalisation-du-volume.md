# Plan : normalisation du volume

Spec : `docs/superpowers/specs/2026-10-27-normalisation-du-volume-design.md` (contraignante). Branche `feat/loudness`. Conventions du dépôt (TypeScript strict, `.ts` dans les imports serveur, Bun pour `tests/unit`, `node --test` pour `server/test`, textes UI en français, commits sans attribution, `yarn validate` vert à chaque commit). Tâches 1 et 3 parallèles ; 2 après 1 ; 4 après 2 et 3.

### Task 1 : mesure et migration

**Files:** Create `server/src/media/loudness.ts`, `server/test/loudness.test.ts`, `server/test/fixtures/ebur128-ffmpeg8.txt` ; Modify `server/src/migrations.ts`, `server/test/db.test.ts`, `server/src/config.ts` (+ `FFMPEG_PATH`), `.env.example`, `Dockerfile`.

- [ ] Selon la spec. Générer la fixture texte avec le vrai `ffmpeg` local (`/opt/homebrew/bin/ffmpeg`) sur un WAV synthétique, et conserver l'extrait du résumé.
- [ ] Commit `Measure track loudness with ffmpeg at import`.

### Task 2 : ingestion, rattrapage et routes

**Files:** Modify `server/src/media/ingest.ts`, `server/src/admin/imports.ts` (file d'attente partagée), `server/src/catalog/tracks.ts` (colonnes, DTO, `updateLoudness`), `server/src/catalog/types.ts`, `server/src/admin/events.ts`, `server/src/app.ts`, `server/src/main.ts` ; Create `server/src/routes/admin-loudness.ts`, `server/test/admin-loudness.test.ts` ; adapter `server/test/helpers.ts` (mesure factice injectée, `available` pilotable).

- [ ] Selon la spec. Les tests d'ingest existants restent verts avec une mesure factice.
- [ ] Commit `Store loudness at import and add the backfill routes`.

### Task 3 : gain côté client

**Files:** Create `lib/loudness.ts`, `tests/unit/loudness.test.ts` ; Modify `lib/catalog.ts` (`TrackDto`, `Song.gainDb`), `lib/music-manager.ts` (GainNode par élément).

- [ ] Selon la spec. Vérifier au navigateur (stack de dev) que la lecture, l'enchaînement et le visualiseur fonctionnent toujours avec les nœuds de gain (les titres ne sont pas encore mesurés : gain 0 dB), et qu'un `gainDb` forcé par `page.evaluate` n'est pas nécessaire : il suffit de constater l'absence d'erreur et la présence des nœuds.
- [ ] Commit `Apply a per-track gain in the audio graph`.

### Task 4 : administration, docs

**Files:** Modify `lib/admin-api.ts`, `components/admin/admin-panel.tsx` (ou nouveau `components/admin/loudness-status.tsx`), `docs/architecture.md`, `docs/ci.md`, `README.md`.

- [ ] Ligne de statut et bouton selon la spec ; vérifier au navigateur avec le bypass admin (le serveur de dev a ffmpeg : lancer l'analyse sur le catalogue de dev et voir les compteurs évoluer).
- [ ] Docs : mesure, colonnes, routes, gain, rattrapage, `FFMPEG_PATH`.
- [ ] `yarn validate` vert ; commit `Add the loudness backfill to the admin panel and document it`.
