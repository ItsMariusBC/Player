# Édition par lot, import par URL et dépôt de dossiers — design

Base : `feat/loudness`. Trois capacités du panneau d'administration.

## Imports vers un dossier

- `POST /api/admin/imports` (multipart) accepte un champ texte optionnel `folderId` **avant** le champ `file`. Dossier inexistant → 400 `bad_request`. Migration `id: 6` : `ALTER TABLE imports ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL; ALTER TABLE imports ADD COLUMN source_url TEXT;`.
- La file d'import passe `folderId: () => folder_id` à `ingestFile` si le dossier existe encore au moment de l'insertion, sinon `null`.
- Règle client : les fichiers déposés ou choisis vont dans le dossier sélectionné dans l'arbre (`null` = boîte de réception), plus le chemin relatif pour un dossier déposé.

## Import par URL

- `POST /api/admin/imports/url` `{ url, folderId? }` → `202 { importId }`. Validation synchrone : `https:` seulement, hôte non littéral IP, longueur ≤ 2048, sinon 400 `bad_request`. Ligne `imports` créée tout de suite (`filename` = dernier segment du chemin décodé et nettoyé `[^\w.-]` → `_`, tronqué à 120, défaut `download`, `source_url` renseigné).
- Téléchargement **hors** de la chaîne sérialisée (sémaphore : 2 téléchargements en parallèle, les autres attendent), dans `incoming/<importId>/upload.bin`, puis `enqueue(importId)` comme un envoi classique. Module `server/src/media/download.ts` : `downloadToFile(url, dest, opts)` réutilisant `pinnedFetch` et `createCheckedLookup` de `metadata/fetch-guard.ts` (adresses non publiques refusées, y compris après redirection), au plus 2 redirections `https:` uniquement, `Content-Length` et flux plafonnés à `maxUploadBytes` (dépassement → abandon), délai de connexion 20 s, durée totale 15 min, `User-Agent` du projet. Aucune liste blanche d'hôtes.
- Échec → `imports.state = failed`, `error = { reason: "download_failed", detail }` avec `detail ∈ { forbidden_host, unreachable, too_large, http_<status>, timeout, redirect }` ; le répertoire `incoming` est supprimé. Journal `import.download_failed` avec `importId`, `detail`, nom d'erreur, jamais l'URL complète (seulement l'hôte).
- Au démarrage, `recoverStaleImports` traite les téléchargements interrompus comme les imports interrompus (déjà `processing` → `failed`).

## Dépôt de dossiers

- Zone de dépôt : les entrées `DataTransferItem.webkitGetAsEntry()` de type répertoire sont parcourues récursivement (profondeur ≤ 8, ≤ 500 fichiers au total, au-delà : bannière « Trop de fichiers (500 max) » et rien n'est envoyé). Seuls `.flac`, `.mp3`, `.wav` (insensible à la casse) sont retenus ; les fichiers cachés (`.` initial) ignorés. Module pur `lib/drop-entries.ts` avec une interface d'entrée minimale injectable pour les tests Bun.
- Bouton « Importer un dossier » à côté de « Choisir des fichiers » : `<input type="file" webkitdirectory>` ; `file.webkitRelativePath` fournit le chemin.
- Chemins → dossiers : `lib/folder-plan.ts` pur : `planFolders(tree, rootId, paths)` renvoie, pour chaque chemin relatif (segments sans le nom du fichier), la liste ordonnée des dossiers à créer (`{ parentKey, name }`) et la résolution finale ; dossiers existants (même nom sous le même parent) réutilisés. Le hook crée les dossiers manquants en séquence via `createFolder` (409 `folder_conflict` → relire l'arbre et réutiliser), puis envoie chaque fichier avec son `folderId`. Les fichiers sans chemin vont dans `rootId`.

## Édition par lot

- `TrackTable` : colonne de cases à cocher (`aria-label` « Sélectionner <titre> »), case d'en-tête « Tout sélectionner » (état indéterminé si partiel), Maj+clic sur une case = plage depuis la dernière case cochée. La sélection vit dans le panneau (`Set<string>`), vidée quand le dossier affiché change.
- Barre d'actions au-dessus du tableau quand la sélection n'est pas vide : « n titres sélectionnés » (« 1 titre sélectionné »), « Déplacer vers… » (menu déroulant natif `<select>` : « Boîte de réception » + dossiers indentés, action immédiate au choix), « Artiste… » et « Album… » (champ en ligne + « Appliquer », vide refusé pour l'artiste ; l'album vide est autorisé), « Supprimer » (confirmation inline « Supprimer n titres ? » Oui/Non, « Non » focalisé), « Désélectionner ».
- Routes admin : `POST /api/admin/tracks/batch` `{ ids: string[] (1..200, uniques), patch: { folderId?: string | null, artist?: string, album?: string } }` (au moins une clé, mêmes validations que PATCH unitaire) → `200 { updated: [{ id, tagsWritten }], missing: string[] }` ; appliqué titre par titre via `applyTrackPatch` sous le verrou du titre ; un échec interne sur un titre n'interrompt pas les autres (il est listé dans `failed: string[]`). `POST /api/admin/tracks/batch-delete` `{ ids }` → `200 { deleted: string[], missing: string[] }`. Événements `admin_events` : `track_batch_update { count, keys }`, `track_batch_delete { count }` (une ligne par lot, sans titres).
- Après un lot : rechargement des deux catalogues, bannière « n titres mis à jour » / « n titres supprimés » (plus « , k introuvables » si `missing`), sélection vidée.

## Tests

- `node --test` : migration 6 ; `folderId` multipart (valide, inexistant, après `file` → ignoré et documenté) ; route URL (400 cas, 202, échec `forbidden_host` avec un `resolve` factice renvoyant une adresse privée, `too_large` par `Content-Length` et par flux, redirection vers `http:` refusée, succès avec un `fetch` factice servant un WAV) ; sémaphore (3 URL → au plus 2 en vol) ; lots (validation, 200 cap, `missing`, `failed`, verrous, événements) ; `recoverStaleImports` inchangé.
- Bun : `drop-entries` (arbre factice, filtre, profondeur, plafond), `folder-plan` (réutilisation, création ordonnée, chemins frères), `import-queue` (entrées URL sans progression), `admin-format` (libellés des lots).
- Playwright `tests/e2e/admin-batch.spec.ts` : sélection de deux titres → « Déplacer vers… » → les deux changent de dossier dans la file du lecteur ; « Artiste… » appliqué aux deux ; suppression par lot avec confirmation ; « Importer un dossier » via `setInputFiles` sur l'entrée `webkitdirectory` avec un répertoire temporaire contenant `Album/un.wav` → dossier « Album » créé et titre dedans. L'import par URL n'a pas d'e2e (adresses locales refusées par construction) : couvert par les tests serveur.
