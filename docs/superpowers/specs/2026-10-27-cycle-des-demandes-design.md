# Boucler le cycle des demandes — design

Base : `feat/ops`. Une demande validée doit mener au titre ajouté, l'utilisateur doit voir le résultat.

## Statuts

- `pending` → `accepted` (l'admin s'en occupe) → `added` (titre importé, lié) ; ou `pending`/`accepted` → `rejected` (motif facultatif ≤ 200). `accepted` reste possible seul (validation sans import immédiat).
- Migration `id: 7` : reconstruction de `song_requests` (SQLite ne modifie pas un `CHECK`) : mêmes colonnes + `track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL`, `reject_reason TEXT`, `CHECK (status IN ('pending','accepted','added','rejected'))`, copie des lignes, index recréés. Plus `ALTER TABLE imports ADD COLUMN request_id TEXT REFERENCES song_requests(id) ON DELETE SET NULL`.
- DTO : `status`, `trackId: string | null`, `rejectReason: string | null` en plus des champs existants.

## Import depuis une demande (admin)

- `POST /api/admin/imports` accepte le champ texte `requestId` (avant `file`, comme `folderId`) : demande inexistante ou déjà `added`/`rejected` → 400 `bad_request`. La ligne `imports` garde `request_id`.
- À la fin de l'import (`ready`) : le titre reçoit **titre, artiste, album** de la demande quand ceux-ci sont non vides (ils priment sur les tags : `IngestInput.title/artist` existants + nouveau `album`), et la pochette de la demande (`cover_url`, hôtes déjà filtrés) est téléchargée via `guardedFetchImage` et appliquée **seulement si le fichier n'a pas de pochette intégrée** ; un échec de pochette est journalisé (`request.cover_failed`) et n'empêche rien. Puis `song_requests.status = 'added'`, `track_id` renseigné, `updated_at` ; événement `admin_events` `request_fulfilled { requestId, trackId }`. Import `duplicate` : la demande passe aussi en `added` avec le `trackId` existant. Import `unsupported` / `internal` : la demande reste telle quelle.
- Le dossier cible reste `folderId` (dossier sélectionné dans l'onglet Catalogue au moment du clic, mémorisé par le panneau).

## Refus (admin)

- `POST /api/admin/requests/:id/reject { reason? }` → `{ request }` ; 404 ; 409 `request_not_pending` si déjà `added`/`rejected` ; événement `request_reject` (sans motif dans le détail).

## Interface admin (onglet Demandes)

- Ligne en attente / acceptée : boutons « Importer » (ouvre un sélecteur de fichier dédié ; le fichier part avec `requestId` et le dossier courant ; la file d'import s'affiche comme d'habitude, libellé « <fichier> → <titre demandé> »), « Valider » (en attente seulement), « Refuser » (champ motif inline + « Confirmer »), « Supprimer ».
- Ligne ajoutée : statut « Ajoutée », bouton « Voir le titre » (bascule sur l'onglet Catalogue, sélectionne le dossier du titre et le titre) ; sans `trackId` (titre supprimé depuis) : statut seul.
- Ligne refusée : statut « Refusée » + motif.
- Le compteur de l'onglet reste le nombre de demandes en attente.

## Côté utilisateur

- Libellés : « En attente », « Acceptée », « Ajoutée », « Refusée » (+ « : motif »). Ligne « Ajoutée » : bouton « Écouter » qui lance le titre s'il est dans la file (`playback.playSong` par id) ; absent sinon.
- Badge « nouveautés » sur le bouton « Demander un son » : point + « (n) » = nombre de demandes de l'utilisateur dont `updatedAt` est postérieur à la dernière ouverture du modal (clé `localStorage` `player.requests.seen.v1`, ISO) et dont le statut n'est plus `pending`. Les demandes sont chargées une fois au montage du lecteur (`GET /api/requests`) et à chaque fermeture du modal ; l'ouverture du modal écrit la clé. Helper pur `unseenRequestChanges(requests, seenAt)` testé.
- « Retirer » reste possible tant que la demande est `pending`.

## Tests

- `node --test` : migration 7 (reconstruction, données conservées, nouveaux statuts acceptés, anciens refusés), `requestId` multipart (inexistant, déjà traitée, OK), accomplissement à l'import (titre/artiste/album appliqués, pochette appliquée seulement sans pochette intégrée, échec pochette journalisé, doublon → `added`, échec → statut inchangé, événement), refus (200, 404, 409, événement), DTO.
- Bun : `unseenRequestChanges`, libellés de statut et de motif.
- Playwright `tests/e2e/requests.spec.ts` étendu : user demande → admin « Importer » avec un WAV frais → la demande passe « Ajoutée » et le titre porte le titre demandé → user voit le badge puis « Ajoutée » et « Écouter » ; admin « Refuser » avec motif → user voit « Refusée : motif ».
