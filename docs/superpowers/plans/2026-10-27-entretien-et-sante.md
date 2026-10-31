# Plan : entretien automatique et état de santé

Spec : `docs/superpowers/specs/2026-10-27-entretien-et-sante-design.md` (contraignante). Branche `feat/ops`. Conventions habituelles. Tâches séquentielles (1 → 2 → 3), toutes touchent `app.ts`/`main.ts`.

### Task 1 : entretien

**Files:** Create `server/src/admin/maintenance.ts`, `server/src/routes/admin-maintenance.ts`, `server/test/maintenance.test.ts` ; Modify `server/src/media/storage.ts` (`listMedia`), `server/src/admin/events.ts` (`maintenance_run`), `server/src/config.ts` (`maintenanceIntervalHours`), `.env.example`, `server/src/app.ts`, `server/src/main.ts`, `server/test/helpers.ts`.

- [ ] Selon la spec. Commit `Clean orphan media and prune old imports on a schedule`.

### Task 2 : état de santé

**Files:** Create `server/src/health.ts`, `server/test/health.test.ts` ; Modify `server/src/config.ts` (`minFreeBytes` via `MIN_FREE_MB`), `.env.example`, `server/src/app.ts`, `server/src/main.ts`, `server/test/helpers.ts`, `server/test/static.test.ts` ou `app-session.test.ts` si `/healthz` y est testé.

- [ ] Selon la spec. Commit `Report migrations, disk space and counters in the health check`.

### Task 3 : administration et docs

**Files:** Modify `lib/admin-api.ts`, `lib/admin-format.ts` (+ test Bun), `components/admin/admin-panel.tsx` ou nouveau `components/admin/system-status.tsx`, `lib/hooks/use-system-status.ts`, `docs/architecture.md`, `docs/ci.md`, `README.md`, `docs/deploy*.md` s'il existe.

- [ ] Selon la spec ; vérification au navigateur (bypass admin) ; `yarn validate` vert ; commit `Show the system status and maintenance in the admin panel`.
