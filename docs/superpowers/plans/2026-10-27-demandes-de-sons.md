# Plan : demandes de sons

Spec : `docs/superpowers/specs/2026-10-27-demandes-de-sons-design.md` (contraignante). Branche `feat/song-requests` depuis `feat/catalogue-admin`. Conventions du dépôt : TypeScript strict, `.ts` dans les imports serveur, `verbatimModuleSyntax`, Tailwind 4, framer-motion via `m.*`, textes UI en français, commits sans aucune attribution. `yarn validate` vert à chaque commit (lint, format:check, typecheck, Bun, serveur, build).

### Task 1 : dépôt et migration

**Files:** Modify `server/src/migrations.ts`, `server/test/db.test.ts` ; Create `server/src/requests/repo.ts`, `server/test/requests-repo.test.ts`.

- [ ] Migration `id: 3` exactement comme la spec.
- [ ] `repo.ts` : `normalizeKey(title, artist)`, `createRequest(db, input, now)` (`input` = `{ userId, title, artist, album, year, source, coverUrl }`), `listUserRequests(db, userId, limit = 50)`, `listAllRequests(db, limit = 200)` (joint `users.display_name`), `findRequest(db, id)`, `acceptRequest(db, id, now)` (renvoie null si absente, `"not_pending"` si déjà validée), `deleteRequest(db, id, opts?: { userId, pendingOnly })` → boolean, `countPending(db, userId)`, `hasPendingDuplicate(db, userId, title, artist)`. Erreurs métier par classes `RequestLimit`, `RequestDuplicate` levées par `createRequest` (vérif + insert dans `inTransaction` de `server/src/catalog/tx.ts`). `toRequestDto(row, { withUser })`.
- [ ] Tests : migration 3 appliquée, insertion et DTO, limite 20, doublon normalisé (casse/accents/espaces), tri (en attente puis validées, récentes d'abord), accept/not_pending, delete owner-only.
- [ ] Commit `Add the song request repository and migration`.

### Task 2 : routes utilisateur et admin

**Files:** Create `server/src/routes/requests.ts`, `server/src/routes/admin-requests.ts`, `server/test/requests-routes.test.ts` ; Modify `server/src/app.ts`, `server/src/admin/events.ts` (actions `request_accept`, `request_delete`).

- [ ] `requestRoutes(deps: { db, metadata?, now, log? }, session)` monté sur `/api/requests` : `GET /search` (copie du handler admin, seulement si `metadata`), `GET /`, `POST /`, `DELETE /:id` selon la spec. Validation avec `readJsonObject` + `onlyKeys` de `routes/catalog-errors.ts` ; `{ proposalId }` → `metadata.getProposal` (404 `proposal_expired` ; sans `metadata` → 400).
- [ ] `adminRequestRoutes(deps, session)` sur `/api/admin/requests` derrière `requireAdmin` : `GET /`, `POST /:id/accept`, `DELETE /:id`, chacun enregistre un `admin_events`.
- [ ] Montage dans `createApp` avant `deps.mount`. Tests via `createTestApp` (comptes `user@test` / `admin@test`, option `metadata.providers` factice pour la recherche) : tous les codes de la spec, CSRF, 403 user sur admin, 404 croisé (user supprime la demande d'un autre), `GET /api/requests/search` sans `metadata` → 404.
- [ ] Commit `Add the song request routes`.

### Task 3 : client et helpers

**Files:** Create `lib/requests-api.ts`, `lib/requests-format.ts`, `tests/unit/requests-format.test.ts`.

- [ ] `requests-api.ts` : `searchSongs(q, { signal })`, `listMyRequests()`, `createRequest(body: { proposalId } | { title })`, `withdrawRequest(id)`, `listAdminRequests()`, `acceptRequest(id)`, `deleteRequest(id)` ; types `SongRequestDto`, `AdminSongRequestDto` ; réutilise `Proposal`, `MetadataSearchResult` de `lib/admin-api.ts`.
- [ ] `requests-format.ts` (pur, testé) : `requestStatusLabel(status)` (« En attente » / « Validée »), `requestDetails(request)` (album · année comme `proposalDetails`), `sortAdminRequests(list)` (défensif, même ordre que le serveur), `pendingCount(list)`, `requestErrorMessage(error)` (codes `request_limit` → « Vous avez déjà 20 demandes en attente », `request_duplicate` → « Vous avez déjà demandé ce titre », `proposal_expired` → « Les propositions ont expiré, relancez la recherche », sinon message de l'erreur ou « Action impossible »).
- [ ] Commit `Add the song request client`.

### Task 4 : modal « Demander un son »

**Files:** Create `components/song-request-dialog.tsx` ; Modify `components/player.tsx`.

- [ ] Modal selon la spec, calqué sur `components/admin/metadata-dialog.tsx` (portail, focus trap, Échap capturé, retour du focus, cooldown `METADATA_SEARCH_COOLDOWN_MS`, `nextMetadataResults` / `metadataResultsNotice` de `lib/admin-format.ts`). Charge « Mes demandes » à l'ouverture. Aucune recherche automatique.
- [ ] `player.tsx` : conteneur de la file en `flex flex-col`, liste dans `min-h-0 flex-1 overflow-y-auto`, bouton « Demander un son » nu (`buttonVariants({ variant: "ghost" })`, pleine largeur, `shrink-0`) sous la liste, visible pour toute session ; état `requestOpen`, modal rendu hors `focusMode` seulement.
- [ ] Vérifier au navigateur (stack de dev, bypass `user`) : ouverture, recherche, demande, retrait.
- [ ] Commit `Add the song request dialog`.

### Task 5 : vue « Demandes » du panneau admin

**Files:** Create `components/admin/request-list.tsx`, `lib/hooks/use-admin-requests.ts` ; Modify `components/admin/admin-panel.tsx`.

- [ ] Hook : `{ requests, refresh, pending }`, charge à l'appel, erreurs via `showError`.
- [ ] Commutateur dans l'en-tête (`role="tablist"`, deux `role="tab"`, `aria-selected`), libellé « Demandes (n) ». La vue remplace la zone centrale ; Échap ferme toujours le panneau.
- [ ] `RequestList` : lignes selon la spec, « Valider », « Supprimer » avec confirmation inline (« Non » focalisé), vide : « Aucune demande ».
- [ ] Vérifier au navigateur (bypass `admin`).
- [ ] Commit `Add the requests view to the admin panel`.

### Task 6 : e2e et documentation

**Files:** Create `tests/e2e/requests.spec.ts` ; Modify `docs/architecture.md`, `README.md`.

- [ ] Scénarios de la spec (sans réseau : « Demander » sur la saisie). Format `oxfmt`.
- [ ] Docs : table des routes, table `song_requests`, événements admin.
- [ ] `yarn validate` et e2e verts ; commit `Add end-to-end scenarios and docs for song requests`.
