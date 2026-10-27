# Demandes de sons — design

Base : `feat/catalogue-admin` (catalogue serveur, panneau d'administration, recherche de métadonnées via MusicBrainz / Deezer / iTunes derrière `server/src/metadata/`).

## Côté utilisateur

- Sous la file d'attente (panneau droit du lecteur), un bouton nu « Demander un son », visible pour toute session (user et admin). Le conteneur de la file passe en colonne : liste défilante en haut, bouton épinglé en bas.
- Le bouton ouvre un modal (portail, même style que `MetadataDialog`) : titre « Demander un son », champ de recherche, bouton « Rechercher » (cooldown 1 s, mêmes règles de validité 2..200 caractères), liste de propositions sélectionnables (pochette, titre, artiste, album · année), bouton « Demander ». Pas de recherche automatique à l'ouverture.
- « Demander » envoie la proposition sélectionnée (`proposalId`) ; sans sélection, la saisie telle quelle (`{ title }`, source `manual`). Succès : ligne « Demande envoyée », la demande apparaît dans « Mes demandes » en bas du modal (statut « En attente » / « Validée », bouton « Retirer » tant qu'elle est en attente).
- Échap ferme le modal, pas le lecteur. Tab reste dans le modal. Focus rendu au bouton à la fermeture.

## Côté administration

- En-tête du panneau : un commutateur « Catalogue | Demandes (n) », n = demandes en attente. La vue « Demandes » remplace la zone centrale (dossiers / titres / éditeur).
- Liste : en attente d'abord (plus récentes en premier), puis validées. Chaque ligne : pochette (ou vide), titre, artiste, album · année, « demandé par <nom> », date, statut. Actions : « Valider » (en attente seulement) et « Supprimer » (confirmation inline Oui/Non, « Non » focalisé par défaut).
- Rechargée à l'ouverture de la vue et après chaque action ; erreurs dans la bannière du panneau.

## Serveur

Migration `id: 3` :

```sql
CREATE TABLE song_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT,
  year INTEGER,
  source TEXT NOT NULL CHECK (source IN ('musicbrainz','deezer','itunes','manual')),
  cover_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX song_requests_status_created ON song_requests(status, created_at);
CREATE INDEX song_requests_user ON song_requests(user_id);
```

`cover_url` ne vient jamais du client : il est copié depuis la proposition cachée par `MetadataSearch.getProposal(id)` (hôtes déjà filtrés par les providers). Une demande manuelle n'a pas de pochette.

DTO `SongRequestDto` : `{ id, title, artist, album, year, source, coverUrl, status, createdAt, updatedAt }` ; côté admin, en plus `requestedBy: { id, displayName }`.

Routes (session requise, en-tête `X-Requested-With: player` sur les mutations, enveloppe d'erreur habituelle) :

| Route | Rôle | Réponse |
|---|---|---|
| `GET /api/requests/search?q=` | tous | identique à `/api/admin/metadata/search` (même instance `MetadataSearch`, donc même limite 1 req/s/provider) ; 400 `bad_request`, 502 `provider_error` ; absente si `metadata` n'est pas configuré |
| `GET /api/requests` | tous | `{ requests: SongRequestDto[] }` de l'utilisateur, plus récentes d'abord, max 50 |
| `POST /api/requests` | tous | corps `{ proposalId }` ou `{ title, artist? }` (title 1..200 non vide, artist ≤200) ; 201 `{ request }` ; 404 `proposal_expired` ; 409 `request_duplicate` (même titre+artiste normalisés déjà en attente pour cet utilisateur) ; 409 `request_limit` (20 en attente par utilisateur) ; 400 `bad_request` (clés inconnues, les deux formes, aucune) |
| `DELETE /api/requests/:id` | tous | 204 si la demande est à lui et en attente ; 404 `request_not_found` sinon |
| `GET /api/admin/requests` | admin | `{ requests }` : en attente puis validées, plus récentes d'abord, max 200, avec `requestedBy` |
| `POST /api/admin/requests/:id/accept` | admin | `{ request }` ; 404 `request_not_found` ; 409 `request_not_pending` ; `admin_events` action `request_accept` |
| `DELETE /api/admin/requests/:id` | admin | 204 ; 404 ; `admin_events` action `request_delete` |

Normalisation titre/artiste : NFKC, minuscules `fr`, espaces réduits, trim (même règle que `proposalKey`).

## Limites et sécurité

- Le client n'envoie jamais d'URL ni de source : seulement un `proposalId` opaque ou du texte.
- Les pochettes affichées côté client sont les URLs des providers, rendues avec `referrerPolicy="no-referrer"` comme dans `MetadataDialog` ; une image cassée affiche l'emplacement vide.
- La recherche utilisateur partage la file d'attente par provider de la recherche admin ; un utilisateur ne peut donc pas contourner la limite.

## Tests

- `node --test` : dépôt (insertion, limite, doublon, tri), routes utilisateur et admin (statuts, 403 pour un user sur les routes admin, 404 croisés), migration 3 dans `db.test.ts`.
- Bun : helpers purs de `lib/requests-format.ts`.
- Playwright : `user@test` ouvre le modal, saisit un titre, « Demander » (sans recherche réseau), voit « En attente » ; `admin@test` ouvre « Demandes », valide, supprime ; `user@test` voit « Validée » avant la suppression.
