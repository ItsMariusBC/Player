# Entretien automatique et état de santé — design

Base : `feat/admin-batch-import`.

## Entretien (`server/src/admin/maintenance.ts`)

- `runMaintenance({ db, storage, now, log, maxImportAgeDays = 30, maxHistoryDays = 90 })` → `{ orphanMedia, orphanIncoming, prunedImports, durationMs }` :
  1. **Médias orphelins** : chaque répertoire `media/<id>` sans ligne `tracks` correspondante est supprimé (`storage.listMedia()` à ajouter : noms de répertoires, `[]` si absent). Les répertoires dont le nom n'est pas un UUID sont ignorés et journalisés une fois (`maintenance.unknown_entry`).
  2. **Réceptions orphelines** : chaque `incoming/<importId>` sans ligne `imports` en état `processing` est supprimé (même règle que `recoverStaleImports`, qui reste au démarrage).
  3. **Historique des imports** : suppression des lignes `imports` en état `failed` plus vieilles que `maxImportAgeDays`, et `ready` plus vieilles que `maxHistoryDays` (`updated_at`). Les lignes `processing` ne sont jamais touchées.
  4. Journal `maintenance.run` avec les compteurs ; une erreur sur un répertoire est journalisée (`maintenance.remove_failed`) et n'interrompt pas la passe.
- Un seul passage à la fois (verrou en mémoire ; un second appel pendant la passe renvoie le résultat de la passe en cours, même promesse).
- Planification dans `main.ts` : une passe au démarrage après `recoverStaleImports`, puis toutes les 24 h (`setInterval(...).unref()`, intervalle injectable, `MAINTENANCE_INTERVAL_HOURS` facultatif, défaut 24, `0` désactive).
- Route admin `POST /api/admin/maintenance/run` → `200` avec le résultat ; événement `admin_events` `maintenance_run` avec les compteurs. `GET /api/admin/maintenance` → `{ lastRunAt, lastResult, running }`.

## État de santé

- `/healthz` reste public et texte : `200 ok` ou `503 degraded` (le `HEALTHCHECK` Docker s'appuie sur le code). Dégradé si : migrations en attente (`schema_migrations` < `MIGRATIONS.length`), ou espace libre du `DATA_DIR` sous `MIN_FREE_MB` (défaut 500), ou `DATA_DIR` inaccessible.
- `GET /api/admin/health` (admin) → `{ status: "ok" | "degraded", reasons: string[], version, uptimeSeconds, migrations: { applied, expected }, disk: { freeBytes, totalBytes }, counts: { tracks, importsProcessing, requestsPending }, ffmpeg: { available }, maintenance: { lastRunAt, lastResult } }`.
- Module `server/src/health.ts` : `createHealth({ db, dataDir, statfs?, minFreeBytes, version, startedAt, ffmpegAvailable, maintenance })` avec `statfs` injectable (`node:fs/promises` `statfs` par défaut) ; en cas d'erreur de `statfs`, `disk: null` et raison `data_dir_unavailable`.
- `main.ts` passe `version` (déjà calculé pour le `User-Agent`) et `startedAt`.

## Administration

- Onglet Catalogue, sous la ligne « Volume » : ligne « Système : v<version> · <espace libre> libres · migrations <applied>/<expected> » (et « · dégradé : <raisons> » en rouge si dégradé) et ligne « Entretien : dernière passe <date heure> (<orphelins supprimés>, <imports purgés>) » avec le bouton « Lancer l'entretien » (désactivé pendant une passe). Chargés à l'ouverture du panneau ; rechargés après le clic.
- Libellés purs testés dans `lib/admin-format.ts` : `formatBytes`, `healthLabel`, `maintenanceLabel`.

## Tests

- `node --test` : entretien (orphelin supprimé, répertoire vivant conservé, réception orpheline supprimée, réception en cours conservée, purge par âge `failed`/`ready`/`processing`, entrée inconnue ignorée, erreur de suppression journalisée sans interruption, verrou de concurrence), route admin (403 user, 200 + événement), santé (`ok`, `degraded` pour chaque raison avec `statfs` factice, `/healthz` 503, détail admin-only), planification (intervalle injecté : la passe se relance ; `0` désactive).
- Bun : libellés.
- E2E : aucun nouveau scénario (la ligne Système est vérifiée au navigateur par le contrôleur). `yarn validate` et la suite e2e existante restent verts.
