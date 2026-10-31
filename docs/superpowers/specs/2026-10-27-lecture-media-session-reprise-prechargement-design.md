# Lecture : Media Session, reprise de session, pré-chargement — design

Base : `feat/song-requests`. Tout est côté client (`lib/`, `components/player.tsx`) ; aucune route serveur ne change.

## Media Session

- Module `lib/media-session.ts` : `bindMediaSession({ music, playback })` renvoie `() => void` (détache). Sans `navigator.mediaSession`, ne fait rien.
- À chaque événement `track` et au premier `play` : `metadata = new MediaMetadata({ title: song.name, artist: song.author, album: song.album, artwork: song.picture ? [{ src: song.picture }] : [] })`. `playbackState` suit `play` / `pause`.
- Actions : `play`, `pause`, `previoustrack`, `nexttrack`, `seekto` (`details.seekTime`), `seekbackward` / `seekforward` (`details.seekOffset ?? 5`), toutes via `PlaybackController`. Chaque `setActionHandler` est dans un `try` : certains navigateurs refusent une action.
- `setPositionState({ duration, position, playbackRate: 1 })` sur `time`, au plus une fois par seconde et seulement si `duration` est fini et > 0 ; sinon `setPositionState()` (reset).
- Helper pur testé : `mediaMetadataInit(song)` (objet passé à `MediaMetadata`) et `throttlePosition` (ou logique équivalente testable sans DOM).
- Branché dans `lib/player-runtime.ts`, détaché dans `destroy()`.

## Reprise de session

- Module `lib/resume-state.ts`. Clé `localStorage` `player.resume.v1`, valeur `{ trackId, position, updatedAt }` (position en secondes, entier ou décimal).
- Helpers purs testés : `parseResumeState(raw: string | null): ResumeState | null` (rejette tout ce qui n'a pas la forme attendue), `resumeTarget(songs, state, now)`: index du titre et position à appliquer, ou `null` si le titre a quitté le catalogue ou si l'état a plus de 30 jours ; position ramenée à 0 si inférieure à 5 s.
- `bindResumeSaver(music, storage)` : sauvegarde sur `time` (au plus une fois par 2 s), `pause`, `track` (position 0 pour le nouveau titre) et sur `pagehide` ; renvoie le détacheur. Lecture/écriture de `localStorage` toujours dans un `try` (mode privé, stockage bloqué).
- Application dans `components/player.tsx` : au **premier** `setSongs` seulement (ref `restoredRef`), si `resumeTarget` existe : `queueManager.setIndex(index)` puis `music.setTime(position)`. Jamais d'autoplay : l'overlay « Activer le lecteur » reste la porte d'entrée. Le titre repris doit être affiché dans « En lecture » et la barre de progression à la bonne position avant tout clic.
- `MusicManager.setTime` doit fonctionner avant le chargement des métadonnées : si `audio.readyState === HAVE_NOTHING`, mémoriser la position et l'appliquer sur `loadedmetadata` (puis oublier).

## Pré-chargement du titre suivant

- `lib/music-manager.ts` passe en double tampon : deux `HTMLAudioElement` (`current`, `standby`), chacun relié une fois au `AudioContext` par son propre `MediaElementAudioSourceNode` vers le même `AnalyserNode`. Les écouteurs (`play`, `pause`, `timeupdate`, `ended`, `loadedmetadata`) sont posés sur les deux éléments et ignorent ceux dont la cible n'est pas `current`.
- Politique : quand `current` émet `canplaythrough` (ou au plus tard après 5 s de lecture), `standby.src = url du titre suivant` (`preload = "auto"`), seulement si cette URL n'est pas déjà chargée. Le « suivant » est `queueManager.songs[(index + 1) % length]`, recalculé sur `queue` et `track`.
- Changement de titre (`onUpdate` de la file) : si `standby.src` correspond à l'URL du nouveau titre, les rôles sont échangés (l'ancien `current` est vidé : `removeAttribute("src")`, `load()`), sinon `current.src` est posé comme aujourd'hui. `wasPlaying` → `play()` comme aujourd'hui.
- `clearSource()` vide les deux éléments. `destroy()` retire les écouteurs des deux.
- Helper pur testé : `nextToPreload(songs, currentIndex)` (null si file vide ou un seul titre).
- Le volume est appliqué aux deux éléments ; `getTime` / `getDuration` / `setTime` lisent `current`.
- Aucun changement des en-têtes de cache du serveur (`private, no-store` reste) : le double tampon ne dépend pas du cache HTTP.

## Hors périmètre

- Normalisation du volume, shuffle, favoris : incréments suivants.

## Tests

- Bun : `tests/unit/media-session.test.ts`, `tests/unit/resume-state.test.ts`, `tests/unit/preload.test.ts` (helpers purs).
- Playwright `tests/e2e/playback.spec.ts` : (1) lecture d'un titre, avance à 20 s via la barre ou `seek`, rechargement de la page → « En lecture » affiche le même titre et `music.getTime()` (lu via l'état DOM de la barre de progression ou `aria-valuenow`) ≈ 20 s ± 3 ; (2) `navigator.mediaSession.metadata.title` égal au titre courant après « Activer le lecteur » ; (3) après 6 s de lecture, le second élément audio a `src` égal à l'URL du titre suivant (exposé via `data-` ou lu par `page.evaluate` sur `document.querySelectorAll("audio")` — les éléments ne sont pas dans le DOM : le moteur expose `music.debugPreloadedUrl()`... non : le test lit `performance.getEntriesByType("resource")` et vérifie qu'une requête vers `/api/media/<nextId>` a eu lieu).
- Vérification navigateur par le contrôleur avant la PR.
