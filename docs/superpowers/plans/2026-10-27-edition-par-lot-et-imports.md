# Plan : édition par lot, import par URL, dépôt de dossiers

Spec : `docs/superpowers/specs/2026-10-27-edition-par-lot-et-imports-design.md` (contraignante). Branche `feat/admin-batch-import`. Conventions habituelles (TypeScript strict, `.ts` dans les imports serveur, Bun pour `tests/unit`, `node --test` pour `server/test`, textes UI en français, commits sans attribution, `yarn validate` vert à chaque commit). Tâches 1, 2 et 3 parallèles (fichiers disjoints) ; 4 après 1 à 3 ; 5 après 4.

### Task 1 : imports vers un dossier et import par URL (serveur)

**Files:** Modify `server/src/migrations.ts`, `server/test/db.test.ts`, `server/src/routes/multipart.ts` (champ `folderId`), `server/src/routes/admin-imports.ts`, `server/src/admin/imports.ts` (résolveur de dossier, `enqueueUrl`, sémaphore), `server/src/main.ts`/`app.ts` si besoin ; Create `server/src/media/download.ts`, `server/test/download.test.ts`, `server/test/admin-imports-url.test.ts` ; adapter `server/test/helpers.ts` (fetch/resolve factices pour le téléchargement).

- [ ] Selon la spec. Commit `Import into a folder and from a URL`.

### Task 2 : routes de lot (serveur)

**Files:** Modify `server/src/routes/admin-tracks.ts`, `server/src/admin/events.ts` ; Create `server/test/admin-tracks-batch.test.ts`.

- [ ] Selon la spec. Commit `Add batch update and delete routes for tracks`.

### Task 3 : bibliothèques client

**Files:** Create `lib/drop-entries.ts`, `lib/folder-plan.ts`, `tests/unit/drop-entries.test.ts`, `tests/unit/folder-plan.test.ts` ; Modify `lib/admin-api.ts` (`uploadFile(file, onProgress, { signal, folderId })`, `importUrl(url, folderId)`, `batchUpdateTracks`, `batchDeleteTracks`), `lib/import-queue.ts` (+ entrées URL : `{ kind: "url" }` sans progression, `failureFromImport` gère `download_failed`), `lib/admin-format.ts` (libellés : `selectionLabel(n)`, `batchResultLabel`), tests Bun correspondants.

- [ ] Selon la spec. Commit `Add the client helpers for folder drops, URL imports and batches`.

### Task 4 : interface

**Files:** Modify `components/admin/upload-zone.tsx` (dépôt de dossiers, « Importer un dossier », formulaire URL « Importer depuis une URL »), `lib/hooks/use-import-queue.ts` (`addFiles(files, { folderId })`, `addEntries(entries, rootId)` avec création des dossiers, `addUrl`), `components/admin/track-table.tsx` (cases), `components/admin/admin-panel.tsx` (sélection, barre d'actions, dossier cible = dossier sélectionné) ; Create `components/admin/batch-bar.tsx`.

- [ ] Selon la spec. Vérifier au navigateur (bypass admin, stack de dev) : dépôt de 2 fichiers dans un dossier sélectionné, « Importer un dossier » (via `setInputFiles` avec un répertoire temporaire), import URL vers une URL publique de test si disponible sinon vérifier l'échec propre `download_failed` affiché, sélection + déplacement + artiste + suppression par lot.
- [ ] Commit `Add batch actions, folder drops and URL imports to the admin panel`.

### Task 5 : e2e et docs

**Files:** Create `tests/e2e/admin-batch.spec.ts` ; Modify `docs/architecture.md`, `docs/ci.md`, `README.md`.

- [ ] Selon la spec ; `yarn validate` et e2e verts ; commit `Add batch and folder import e2e scenarios and docs`.
