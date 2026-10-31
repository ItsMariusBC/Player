# Plan : Media Session, reprise de session, pré-chargement

Spec : `docs/superpowers/specs/2026-10-27-lecture-media-session-reprise-prechargement-design.md` (contraignante). Branche `feat/playback-polish`. Conventions : TypeScript strict, Bun pour les tests `tests/unit`, textes UI en français, commits sans attribution, `yarn validate` vert à chaque commit. Les tâches 1, 2 et 3 touchent des fichiers disjoints et s'exécutent en parallèle.

### Task 1 : reprise de session

**Files:** Create `lib/resume-state.ts`, `tests/unit/resume-state.test.ts` ; Modify `components/player.tsx`.

- [ ] Helpers purs et `bindResumeSaver` selon la spec ; tests : parsing (valeurs invalides, JSON cassé), cible (titre absent, état trop vieux, position < 5 s → 0), sauvegarde throttlée (horloge injectée) et `pagehide`.
- [ ] `player.tsx` : brancher le saver après `createPlayerRuntime` (détaché au démontage), restaurer au premier `setSongs`. Ne pas toucher à `music-manager.ts` (Task 3 l'édite) : si `setTime` avant métadonnées ne tient pas, l'écrire via un écouteur `loadedmetadata` côté Task 3, et le signaler.
- [ ] Commit `Resume the last track and position on load`.

### Task 2 : Media Session

**Files:** Create `lib/media-session.ts`, `tests/unit/media-session.test.ts` ; Modify `lib/player-runtime.ts`.

- [ ] Module selon la spec ; tests sur `mediaMetadataInit` et la cadence de `setPositionState` avec un faux `mediaSession` injecté (le module accepte `navigator`-like en option pour les tests).
- [ ] Branché dans le runtime, détaché dans `destroy()`.
- [ ] Commit `Expose playback through the Media Session API`.

### Task 3 : pré-chargement du titre suivant

**Files:** Modify `lib/music-manager.ts` ; Create `lib/preload.ts`, `tests/unit/preload.test.ts`.

- [ ] Double tampon selon la spec, `nextToPreload` pur et testé, `setTime` avant métadonnées (mémorisé puis appliqué sur `loadedmetadata`).
- [ ] Vérifier au navigateur que l'enchaînement de fin de piste joue le titre suivant sans erreur console, que « précédent » et un saut fonctionnent, que le visualiseur réagit toujours après un échange d'éléments.
- [ ] Commit `Preload the next track on a second audio element`.

### Task 4 : e2e et documentation

**Files:** Create `tests/e2e/playback.spec.ts` ; Modify `docs/architecture.md`, `README.md`.

- [ ] Scénarios de la spec. Docs : nouvelles lignes du tableau Performance (pré-chargement), section « Chorégraphie » (échange d'éléments), paragraphe Media Session et reprise ; README : fonctionnalités.
- [ ] `yarn validate` et e2e verts ; commit `Add playback e2e scenarios and docs`.
