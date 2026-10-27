# Architecture du lecteur

Le code est organisé en couches. Une couche ne dépend que de celles situées en dessous.

| Couche       | Fichiers                                                                               | Rôle                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moteur       | `lib/music-manager.ts`, `lib/queue-manager.ts`                                         | Élément `<audio>`, `AudioContext`, file de lecture (alimentée par le catalogue serveur). Émet des `PlayerEvent` (`play`, `pause`, `track`, `time`, `queue`). Ignore l'interface.                                                                                                                                                                                                 |
| Contrôleurs  | `lib/playback-controller.ts`, `lib/notification-manager.ts`, `lib/shortcut-manager.ts` | `PlaybackController` est l'unique point d'entrée des actions (lecture, pause, stop, piste suivante/précédente, seek, volume). `NotificationManager` transforme les événements en une seule notification visible à la fois. `ShortcutManager` relie le clavier au contrôleur.                                                                                                     |
| Composition  | `lib/player-runtime.ts`                                                                | `createPlayerRuntime()` assemble moteur, contrôleurs et raccourcis, et expose `destroy()`. C'est le seul endroit où les instances sont créées.                                                                                                                                                                                                                                   |
| Présentation | `components/**`, `lib/hooks/**`                                                        | Composants React sans logique métier. `usePlaybackState(music)` fournit l'état courant ; les actions passent par `playback`. `useSongGradient(song)` fournit les couleurs du fond. Pour les admins, `AdminButton` s'affiche à côté du lien de déconnexion (`CornerActions`) et ouvre `AdminPanel` (coquille vide, démonte le reste de l'interface comme le visualiseur agrandi). |

## Règles

- Un composant ne modifie jamais l'état du moteur directement : il appelle `playback.*`.
- Un composant n'écoute jamais `<audio>` : il lit `usePlaybackState` ou s'abonne à `music.subscribe`.
- Les notifications sont une politique (`lib/notification-manager.ts`) et une vue (`components/song-notification.tsx`). La politique est testée sans DOM.
- Le catalogue vient de `GET /api/catalog` (`lib/catalog.ts`, `useCatalog()` : chargement au montage, toutes les 60 s et sur `refresh()`). `flattenCatalog` en tire la file : à chaque niveau, les sous-dossiers d'abord (profondeur d'abord, ordre de l'arbre) puis les titres du niveau par `position` ; les titres racine viennent donc en dernier. La liste affiche l'arbre dans ce même ordre. Médias et pochettes sont servis par `/api/media/:id` et `/api/media/:id/cover` (même origine, cookie de session).
- À chaque nouveau catalogue, `queueManager.setSongs` conserve le titre courant par `id` ; s'il a disparu, la file reprend au même index. Un rafraîchissement sans changement du titre courant ne relance pas la lecture.
- Le fond dégradé est dérivé de la pochette (`lib/palette.ts`).
- Le fond est une scène React Three Fiber maison (`components/gradient/`), shaders repris de shadergradient 1.3.5 (MIT). Les couleurs sont des uniforms mutés dans la boucle de rendu : un changement de piste ne provoque ni re-render React ni recompilation de shader. Rendu à la demande à 30 i/s (`FRAMES_PER_SECOND`), `dpr` 1, sans `preserveDrawingBuffer`, chargé en chunk séparé après le premier rendu.

## Performance

| Poste               | Choix                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fond WebGL          | 30 i/s à la demande, pause quand l'onglet est caché, uniforms mutés sans React, chunk différé (`React.lazy`).                                                                                                              |
| Flou d'arrière-plan | Seules les cartes ont un `backdrop-filter` ; les boutons à l'intérieur n'en ont plus (même rendu, un calque de flou en moins chacun). En mode visualiseur agrandi, plus aucun flou et le reste de l'interface est démonté. |
| Visualiseur         | Un seul `fill()` par image, taille suivie par `ResizeObserver`, `requestAnimationFrame` annulé au démontage.                                                                                                               |
| Animations          | `LazyMotion` + composants `m`, fonctionnalités chargées à la demande (`lib/motion-features.ts`).                                                                                                                           |
| Images              | Dimensions explicites, `decoding="async"`, `loading="lazy"` dans la file d'attente.                                                                                                                                        |

## Chorégraphie d'un changement de piste

Constantes dans `lib/transitions.ts`. Ordre garanti : fond, puis carte, puis notification.

| Instant | Élément       | Détail                                                                                        |
| ------- | ------------- | --------------------------------------------------------------------------------------------- |
| 0 ms    | Gradient      | Fondu de couleurs sur 1000 ms (`useSongGradient`, interpolation RVB à ~30 i/s).               |
| 150 ms  | Carte lecteur | Pochette, titre et artiste sortent puis entrent (350 ms).                                     |
| 450 ms  | Notification  | `NotificationManager` retarde la notification de piste ; un second skip annule la précédente. |

## Événements

```
<audio> play/pause/timeupdate/ended ─┐
QueueManager.onUpdate ───────────────┼─► MusicManager.emit(PlayerEvent)
                                     │        ├─► usePlaybackState (vues)
                                     │        ├─► NotificationManager ─► SongNotificationProvider
                                     │        └─► MusicPlayer (re-rendu)
Clavier ─► ShortcutManager ─┐
Boutons ────────────────────┴─► PlaybackController ─► MusicManager / QueueManager
```

## Raccourcis clavier

Actifs uniquement quand aucun élément n'a le focus.

| Touche | Action                             |
| ------ | ---------------------------------- |
| Espace | Lecture / pause                    |
| ↑ / ↓  | Piste précédente / suivante        |
| ← / →  | Reculer / avancer de 5 s           |
| M      | Afficher / masquer le mini-lecteur |

## Développement

`yarn dev` lance trois processus : Vite (`http://localhost:3000`, qui proxifie `/api` vers l'API), l'API (`http://localhost:8080`, configurée par `.env.development`) et un fournisseur OIDC factice (`http://localhost:3002`, `server/dev/mock-oidc.ts`). Le navigateur ne parle qu'à `:3000` : `APP_URL` vaut donc `http://localhost:3000` et le callback OIDC revient par le proxy.

Pour tester la connexion, ouvrir `http://localhost:3000/api/auth/login` puis se connecter avec l'un des comptes (n'importe quel mot de passe) :

| Compte        | Groupes     |
| ------------- | ----------- |
| `admin@test`  | `["admin"]` |
| `user@test`   | `["users"]` |
| `nobody@test` | `[]`        |

`GET /api/session` renvoie ensuite le rôle déduit des groupes.

Quand `DEV_BYPASS_LOGIN=true` (activé dans `.env.development`), l'écran de connexion de test propose « Entrer en admin » et « Entrer en user », qui ouvrent une session sans passer par le fournisseur OIDC, avec les identités `dev-admin` / `dev-user` (émetteur `dev-bypass`). Ces sessions ne sont pas revérifiées auprès du fournisseur. Le serveur refuse de démarrer si `DEV_BYPASS_LOGIN=true` avec `NODE_ENV=production`.

Le fournisseur factice expose des routes de contrôle : `GET /mock/accounts` liste l'état des comptes, et `POST /mock/accounts/:id` avec un corps JSON `{ "groups": [...], "disabled": true }` modifie les groupes ou désactive un compte (le prochain rafraîchissement de session échoue). Exemple :

```sh
curl -X POST localhost:3002/mock/accounts/user@test -H 'content-type: application/json' -d '{"groups":["admin"]}'
```

`.env.development` est versionné : il ne contient aucun secret réel (clé de session et client OIDC propres au développement). Le dossier `.data/` (données de l'API) est ignoré par git.
