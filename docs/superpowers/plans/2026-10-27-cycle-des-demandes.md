# Plan : boucler le cycle des demandes

Spec : `docs/superpowers/specs/2026-10-27-cycle-des-demandes-design.md` (contraignante). Branche `feat/request-cycle`. Conventions habituelles. Tâches 1 et 2 parallèles ; 3 après ; 4 après 3.

### Task 1 : serveur

**Files:** Modify `server/src/migrations.ts`, `server/test/db.test.ts`, `server/src/requests/repo.ts`, `server/src/routes/admin-requests.ts`, `server/src/routes/multipart.ts` (champ `requestId`), `server/src/routes/admin-imports.ts`, `server/src/admin/imports.ts` (accomplissement), `server/src/media/ingest.ts` (`album`), `server/src/admin/events.ts` (`request_reject`, `request_fulfilled`), `server/test/helpers.ts` (fetch/resolve factices pour la pochette via `metadata`) ; tests dans `server/test/requests-routes.test.ts`, `server/test/requests-repo.test.ts`, `server/test/admin-imports.test.ts` (ou nouveau `request-fulfilment.test.ts`).

- [ ] Selon la spec. Commit `Fulfil or reject song requests from the admin import`.

### Task 2 : bibliothèques client

**Files:** Modify `lib/requests-api.ts` (DTO, `rejectRequest`), `lib/requests-format.ts` (+ test : libellés des 4 statuts, motif, `unseenRequestChanges`), `lib/admin-api.ts` (`uploadFile` option `requestId`), `lib/import-queue.ts` / `lib/admin-format.ts` (libellé « <fichier> → <titre demandé> » : entrée avec `requestTitle`), `lib/hooks/use-import-queue.ts` (`addFiles(files, { folderId, requestId, requestTitle })`) ; Create `lib/request-badge.ts` (lecture/écriture de la clé vue, pur avec stockage injecté) + test.

- [ ] Selon la spec. Commit `Add the client helpers for the request lifecycle`.

### Task 3 : interface

**Files:** Modify `components/admin/request-list.tsx`, `components/admin/admin-panel.tsx` (Importer avec sélecteur dédié, Refuser, Voir le titre), `components/song-request-dialog.tsx` (statuts, Écouter, écrit la clé vue à l'ouverture), `components/player.tsx` (badge, chargement des demandes, rechargement à la fermeture, passe `playback` au modal).

- [ ] Selon la spec ; vérification navigateur (user puis admin) ; commit `Close the request loop in the admin panel and the player`.

### Task 4 : e2e et docs

**Files:** Modify `tests/e2e/requests.spec.ts`, `docs/architecture.md`, `docs/ci.md`, `README.md`.

- [ ] Selon la spec ; `yarn validate` et e2e verts ; commit `Add the request lifecycle e2e scenarios and docs`.
