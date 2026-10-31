# Entretien automatique et état de santé — design

Base : `feat/admin-batch-import`.

## Entretien (`server/src/admin/maintenance.ts`)

- `runMaintenance({ db, storage, now, log, maxImportAgeDays = 30, maxHistoryDays = 90 })` → `{ orphanMedia, orphanIncoming, prunedImports, durationMs }` :
  1. **Médias orphelins** : un répertoire `media/<id>` (`storage.listMedia()` : noms de répertoires, `[]` si absent) n'est supprimé que si TOUTES ces conditions tiennent : son nom est un UUID (sinon ignoré et journalisé une fois par passe, `maintenance.unknown_entry`) ; son `mtime` et celui de ses enfants directs (un `readdir` + `stat`) datent de plus du délai de grâce `MAINTENANCE_GRACE_MS` = 1 h (`graceMs` injectable) ; et une requête FRAÎCHE, juste avant la suppression, confirme qu'aucune ligne `tracks` ne porte cet id. Les listings se font d'abord, les instantanés (ids de `tracks`, imports `processing`) ensuite. Un listing en échec est journalisé (`maintenance.list_failed`) et la passe continue avec la phase suivante.
  2. **Réceptions orphelines** : même règle pour `incoming/<importId>` : nom UUID (sinon ignoré et journalisé), âge au-delà du délai de grâce, et requête fraîche confirmant qu'aucune ligne `imports` en état `processing` ne porte cet id (`recoverStaleImports` reste au démarrage).
  3. **Historique des imports** : suppression des lignes `imports` en état `failed` plus vieilles que `maxImportAgeDays`, et `ready` plus vieilles que `maxHistoryDays` (`updated_at`). Les lignes `processing` ne sont jamais touchées.
  4. Journal `maintenance.run` avec les compteurs ; une erreur sur un répertoire est journalisée (`maintenance.remove_failed`) et n'interrompt pas la passe.
- Un seul passage à la fois (verrou en mémoire ; un second appel pendant la passe renvoie le résultat de la passe en cours, même promesse).
- Planification dans `main.ts` : une passe au démarrage, lancée après `serve()` sans être attendue (`void maintenance.run().catch(log)`; `recoverStaleImports` reste attendu), puis toutes les 24 h (`setInterval(...).unref()`, intervalle injectable, `MAINTENANCE_INTERVAL_HOURS` facultatif, défaut 24, `0` désactive).
- Route admin `POST /api/admin/maintenance/run` → `200` avec le résultat ; événement `admin_events` `maintenance_run` avec les compteurs. `GET /api/admin/maintenance` → `{ lastRunAt, lastResult, running }`.

## État de santé

- `/healthz` reste public et texte : `200 ok` ou `503 degraded` (le `HEALTHCHECK` Docker s'appuie sur le code). Il s'appuie sur `check()`, léger : migrations (`schema_migrations` < `MIGRATIONS.length`) et `statfs` du `DATA_DIR` couru contre un minuteur de 2 s (dépassement : `data_dir_unavailable`) ; ni comptages ni ffmpeg. Dégradé si : migrations en attente, espace libre sous `MIN_FREE_MB` (défaut 500), `DATA_DIR` inaccessible, ou erreur de base (`db_unavailable`, jamais un 500). `degraded` signifie « alerter, ne pas redémarrer » : une sonde de vivacité ne doit pas pointer dessus (disponibilité et alerte seulement).
- `GET /api/admin/health` (admin) s'appuie sur `evaluate()` (détail complet ; une erreur de base donne `db_unavailable` et un rapport dégradé, pas un 500) → `{ status: "ok" | "degraded", reasons: string[], version, uptimeSeconds, migrations: { applied, expected }, disk: { freeBytes, totalBytes }, counts: { tracks, importsProcessing, requestsPending }, ffmpeg: { available }, maintenance: { lastRunAt, lastResult } }`.
- Module `server/src/health.ts` : `createHealth({ db, dataDir, statfs?, minFreeBytes, version, startedAt, ffmpegAvailable, maintenance })` avec `statfs` et `statfsTimeoutMs` injectables (`node:fs/promises` `statfs` par défaut) ; en cas d'erreur de `statfs`, `disk: null` et raison `data_dir_unavailable`.
- `main.ts` passe `version` (déjà calculé pour le `User-Agent`) et `startedAt`.

## Administration

- Onglet Catalogue, sous la ligne « Volume » : ligne « Système : v<version> · <espace libre> libres · migrations <applied>/<expected> » (et « · dégradé : <raisons> » en rouge si dégradé) et ligne « Entretien : dernière passe <date heure> (<orphelins supprimés>, <imports purgés>) » avec le bouton « Lancer l'entretien » (désactivé pendant une passe). Chargés à l'ouverture du panneau ; rechargés après le clic.
- Libellés purs testés dans `lib/admin-format.ts` : `formatBytes`, `healthLabel` (raisons en français : espace disque faible, migrations en attente, dossier de données inaccessible, base de données inaccessible ; code inconnu affiché tel quel), `maintenanceLabel`.
- Le test ffmpeg négatif est mis en cache 5 minutes (`availableCheckedAt` dans `imports.ts`) : `evaluate()` ne lance jamais un processus par appel.

## Tests

- `node --test` : entretien (orphelin supprimé, répertoire vivant conservé, réception orpheline supprimée, réception en cours conservée, répertoire plus jeune que le délai de grâce conservé, ligne apparue après l'instantané respectée, échec de listing sans interruption, entrées incoming non UUID ignorées, purge par âge `failed`/`ready`/`processing`, entrée inconnue ignorée, erreur de suppression journalisée sans interruption, verrou de concurrence), route admin (403 user, 200 + événement), santé (`ok`, `degraded` pour chaque raison avec `statfs` factice, `/healthz` 503 et sans sonde ffmpeg, délai de `statfs`, erreur de base, cache négatif, détail admin-only), planification (intervalle injecté : la passe se relance ; `0` désactive).
- Bun : libellés.
- E2E : aucun nouveau scénario (la ligne Système est vérifiée au navigateur par le contrôleur). `yarn validate` et la suite e2e existante restent verts.
