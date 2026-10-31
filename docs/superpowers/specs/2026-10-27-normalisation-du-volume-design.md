# Normalisation du volume — design

Base : `feat/playback-polish`. Objectif : des niveaux comparables entre titres (MP3, FLAC, WAV) sans toucher aux fichiers.

## Mesure (serveur)

- Mesure EBU R128 par `ffmpeg` à l'import : `ffmpeg -nostdin -hide_banner -i <fichier> -af ebur128=peak=true:framelog=quiet -f null -`. On lit sur stderr, dans le résumé final, `I: <x> LUFS` (loudness intégrée) et `Peak: <y> dBFS` (true peak). Parseur pur `parseEbur128(stderr): { lufs, truePeakDbtp } | null` (null si `-inf`, absent ou illisible).
- Module `server/src/media/loudness.ts` : `measureLoudness(path, { ffmpegPath, timeoutMs = 120_000, run? })` ; `run` injectable (tests) ; `ffmpegPath` vient de `FFMPEG_PATH` (défaut `ffmpeg`). Binaire absent (ENOENT) → `null` et un log `loudness.unavailable` une seule fois par processus ; autre échec → `null` et log `loudness.failed` (nom, code de sortie, jamais la sortie complète).
- Migration `id: 4` : `ALTER TABLE tracks ADD COLUMN loudness_lufs REAL; ALTER TABLE tracks ADD COLUMN true_peak_dbtp REAL;` (NULL = non mesuré). Migration `id: 5` : `ALTER TABLE tracks ADD COLUMN loudness_measured_at TEXT;` horodatage de la dernière tentative (succès ou échec) ; NULL = jamais tenté.
- `ingestFile` mesure après la sonde et avant l'insertion (la file d'import est déjà sérialisée : un `ffmpeg` à la fois). L'échec de la mesure n'échoue jamais l'import.
- Rattrapage : `POST /api/admin/loudness/backfill` (admin) démarre une passe sur les titres `ready` dont `loudness_measured_at IS NULL`. La passe est **paresseuse** : chaque étape prend le prochain titre en base, le mesure sur la chaîne sérialisée des imports, puis enchaîne l'étape suivante, de sorte qu'un import déposé pendant la passe s'intercale. Une seule passe à la fois (un second appel pendant la passe répond `202 { queued: 0, running: true }`) ; un titre en cours n'est jamais remesuré ; chaque étape revérifie `loudness_measured_at IS NULL`. Toute tentative (succès, `-inf`, échec) pose `loudness_measured_at`, afin qu'un titre silencieux ou illisible sorte de `pending`. `updated_at` n'est **pas** modifié (il pilote le cache des pochettes côté client). Si ffmpeg est indisponible : `409 ffmpeg_unavailable`, rien n'est mis en file ni journalisé. Réponse `202 { queued, running }`. `GET /api/admin/loudness` → `{ total, measured, failed, pending, running, available }` (`failed` = tenté sans valeur ; `running` = passe en cours ; `available` = ffmpeg trouvé, seul un résultat positif est mis en cache). Événement `admin_events` `loudness_backfill` avec `{ queued }` seulement quand une passe démarre.
- `Dockerfile` : `apk add --no-cache ffmpeg` dans l'étape runtime. `.env.example` : `FFMPEG_PATH`. `docs/ci.md` : procédure de rattrapage après migration.

## Gain (client)

- `TrackDto` expose `loudnessLufs: number | null` et `truePeakDbtp: number | null` ; `Song` reçoit `gainDb: number` calculé côté client par `replayGain({ lufs, truePeakDbtp }, target = -14)` (pur, dans `lib/loudness.ts`) : `gain = target - lufs`, borné à [-20, +12] dB, puis réduit pour que `truePeakDbtp + gain ≤ -1` dBTP quand le pic est connu ; `0` si `lufs` est null.
- Moteur : un `GainNode` par élément entre sa `MediaElementAudioSourceNode` et l'analyseur. Le gain d'un élément est fixé quand on lui affecte un titre (`setPlaying`, pré-chargement, y compris quand le titre pré-chargé est déjà en place) : `gain.value = 10 ** (gainDb / 20)`. Tant que le contexte audio n'existe pas, le gain voulu est mémorisé et appliqué à la création des nœuds. Le volume utilisateur (`setVolume`) reste sur `element.volume`.
- Rien à régler dans l'interface : la normalisation est toujours active. Le titre non mesuré joue à 0 dB.

## Administration

- Dans l'onglet Catalogue, sous le tableau des titres, une ligne « Volume : n titres sur m analysés » avec un bouton « Analyser les titres restants » (désactivé si `pending = 0` ou `available = false`, dans ce dernier cas texte « ffmpeg introuvable sur le serveur »). Le statut se rafraîchit toutes les 2 s tant que `running` est vrai (relances chaînées, jamais deux requêtes en vol), sinon à l'ouverture du panneau. Les titres `failed` sont comptés à part : « n titres sans mesure » si `failed > 0`.

## Tests

- `node --test` : `parseEbur128` (sortie réelle de ffmpeg 8 incluse en fixture texte, cas `-inf`, cas absent), `measureLoudness` avec `run` factice (succès, ENOENT, timeout, code ≠ 0), migration 4, ingest stocke les valeurs (sonde et mesure factices), routes admin (403 user, 202 et compteurs, `available=false`), une intégration réelle `ffmpeg` sautée (`t.skip`) si le binaire est absent, sur un WAV généré avec un ton à -20 dBFS (loudness attendue ≈ -23 LUFS ± 1,5).
- Bun : `replayGain` (bornes, pic, null).
- E2E : rien de nouveau (les fixtures sont du silence : loudness `-inf` → null, le lecteur doit jouer à 0 dB sans erreur). `yarn validate` et la suite e2e existante restent verts.
