# 01 — Contexte, état initial et périmètre

## 1. Produit et utilisateurs

Sheldon Player est un lecteur musical dans le navigateur. Le périmètre confirmé est un catalogue partagé derrière Authentik, administré par le groupe admin, avec écoute et favoris individuels pour users et admin. Les parcours couvrent ordinateur et téléphone avec des commandes tactiles lisibles. Le fonctionnement sans compte décrit par le code initial est remplacé par cette cible.

Le caractère personnel du projet est confirmé par la réponse 1A. Hypothèses de dimensionnement : catalogue de référence de 10 titres, jusqu'à 1 000 entrées de métadonnées pour les essais de recherche, données désormais centralisées côté serveur. Le volume réel, le calendrier et le budget ne sont pas fournis. Le nouveau besoin justifie une architecture multi-utilisateur centralisée.

## 2. État constaté le 23 octobre 2026

### 2.1 Structure

| Zone | Fichiers actuels | Fonction |
| --- | --- | --- |
| Entrée | `src/main.tsx`, `src/app.tsx`, `index.html` | Application React montée côté navigateur |
| Écran principal | `components/player.tsx` | Composition du lecteur, file, clavier et mini-lecteur |
| Moteur | `lib/music-manager.ts`, `lib/queue-manager.ts` | Élément audio, graphe Web Audio et navigation |
| Données | `lib/storage-manager.ts`, `lib/playlist-manager.ts`, `music/data.d.ts` | Morceaux personnalisés et playlists |
| Personnalisation | `lib/theme-manager.ts`, `components/dark-mode-toggle.tsx` | Thèmes, modes clair/sombre/système |
| Rendu | `components/gradient.tsx`, `components/music-visualizer/` | Fond 3D et visualiseur Canvas |
| Commandes | `components/control/`, `components/mini-player.tsx` | Dialogues, contrôles et lecteur réduit |
| Métadonnées | `lib/metadata-fetcher.ts`, `components/song-recognition.tsx` | Identification simulée et édition manuelle |
| Catalogue | `music/data.json`, `music/generate.mjs`, `public/` | 10 morceaux référencés, pochettes et génération |
| Outillage | `package.json`, `vite.config.ts`, `tsconfig.json` | Vite, TypeScript et scripts |

Versions déclarées : React `^18.2.0`, Vite `^5.1.6`, Tailwind CSS `^3.3.7`, TypeScript `^5.4.2`, Framer Motion `^10.9.2`, Three.js `^0.150.0`. Ces plages ne constituent pas les versions cibles. Une vérification de compatibilité est requise avant toute mise à jour.

Deux fichiers de verrouillage coexistent : `pnpm-lock.yaml` et `yarn.lock`. Aucun répertoire `.git` n'a été trouvé à la racine pendant l'analyse. Aucun script de test, de lint ou de contrôle des types n'est déclaré dans `package.json`. Aucun dossier de tests n'a été identifié dans l'inventaire du code applicatif.

### 2.2 Observations de fonctionnement

Au lancement initial, Rollup et esbuild ne disposaient que de leurs paquets natifs Windows. Les paquets macOS ARM64 correspondant aux versions installées ont été ajoutés dans `node_modules`, sans changement du manifeste. Le lancement doit donc être fiabilisé par une installation propre reproductible, et non par la copie de ce répertoire.

Vite a démarré sur `http://127.0.0.1:3000/`. Un contrôle dans Chrome avec un profil temporaire a observé l'écran initial, l'activation, la lecture du premier fichier, la progression du média, la pause et l'ouverture du menu sans erreur JavaScript capturée pendant ce parcours. Cela ne constitue pas une recette de toutes les fonctionnalités ni de tous les navigateurs.

Le contrôle suivant a été relancé pendant la rédaction et échoue :

```sh
./node_modules/.bin/tsc --noEmit --incremental false
```

Diagnostic : `components/player.tsx(151,40): error TS2322` ; la propriété `features` n'existe pas dans `MotionConfigProps`.

### 2.3 Défauts et risques issus de la lecture du code

Ces constats statiques doivent être reproduits en T002 avant de conclure sur leur effet exact dans le navigateur.

| Réf. | Constat et emplacement | Conséquence possible | Tâches |
| --- | --- | --- | --- |
| A01 | `features` transmis à `MotionConfig` dans `components/player.tsx` | Contrôle TypeScript en échec, confirmé par la commande ci-dessus | T013 |
| A02 | Espace géré dans `components/player.tsx` et `lib/shortcut-manager.ts` | Deux bascules de lecture pour une seule action | T020, T023 |
| A03 | Retour avant le début fondé sur `songs.length` du catalogue importé dans `lib/queue-manager.ts` | Mauvais indice pour une playlist plus courte ou plus longue | T019, T023 |
| A04 | Callbacks remplacés puis restaurés par le lecteur principal, le mini-lecteur et les notifications | Abonnements incohérents selon l'ordre de montage/démontage | T015, T016 |
| A05 | `requestAnimationFrame` sans annulation explicite dans le visualiseur amélioré | Plusieurs boucles ou traitement inutile après un changement d'analyseur | T041, T048 |
| A06 | Analyseur temporaire puis analyseur réel dans `lib/music-manager.ts` ; absence de contrat de chargement/erreur ; écoute `canplay` ponctuelle | Cycle de vie et concurrence de commandes fragiles | T017, T018 |
| A07 | `JSON.parse` sans validation de schéma dans les gestionnaires de stockage | Démarrage fragile si une valeur enregistrée est invalide | T024, T025 |
| A08 | Playlists stockées par URL et titres de file identifiés par indice | Identité instable après tri, import ou modification d'URL | T015, T024, T026 |
| A09 | `getPlaylistSongs` filtre le catalogue plutôt que de parcourir les références de la playlist | Ordre de playlist potentiellement perdu | T026, T033 |
| A10 | Métadonnées et pochettes factices dans `lib/metadata-fetcher.ts` | Promesse d'identification audio non tenue | T028, T030 |
| A11 | Couleurs violettes codées dans les composants ; variables de thème distinctes ; préférence système capturée au montage | Thèmes et mode clair/sombre partiellement appliqués | T034, T039 |
| A12 | Boutons du lecteur principal sans nom accessible ; sélection des titres par `div` cliquable | Commandes difficiles au clavier et au lecteur d'écran | T036, T037, T044 |
| A13 | Barres de progression visibles non interactives dans l'information principale et le mini-lecteur | Déplacement temporel peu évident malgré un composant `Timeline` séparé | T021, T036, T040 |
| A14 | Résultats du générateur ajoutés selon l'achèvement des tâches ; titre/artiste issus de tags éventuellement absents | Catalogue réordonné ou incomplet après génération | T032 |

## 3. Évolution confirmée du besoin

React, identité violette et programme complet par étapes sont confirmés. Le produit devient multi-utilisateur : Authentik contrôle l'accès, les administrateurs alimentent le catalogue et chacun conserve ses favoris. Les users n'ajoutent aucun fichier et ne créent aucune playlist.

Les observations précédentes décrivent la version de départ. Elles ne prouvent aucun fonctionnement du futur backend/Auth/dashboard.

## 4. Périmètre retenu

- Frontend React/Vite modernisé ; moteur audio, file, clavier et progression fiables.
- Authentik obligatoire et autorisation users/admin.
- Dashboard distinct d'import FLAC/MP3/WAV et de gestion du catalogue commun.
- API, base et stockage privé ; aucun audio publié hors contrôle d'accès.
- Favoris individuels côté serveur, isolés entre comptes.
- Recherche/catalogue et file ; aucune playlist privée.
- Thème unique avec shaders ; retrait des modes et sélecteurs de thème.
- Retrait des titres visibles Sheldon Player/Click to Play, du Menu et de tout son contenu.
- Visualiseur plein écran/retour ; liste sans scrollbar visible mais défilable.
- Tests des rôles, accès direct médias, isolation, upload, lecture et restauration.

Aucun déplacement des anciens contenus du Menu n'est prévu. Les commandes fondamentales restent près du morceau ; le dashboard est un nouvel écran dédié.

## 5. Hors périmètre et options

Hors périmètre : mots de passe/inscription locaux, ajouts users, bibliothèque locale personnelle, playlists privées, partage public, gestion des comptes Authentik depuis le dashboard et migration automatique de données locales vers un compte arbitraire.

Options non sélectionnées : export/import personnel de métadonnées, Media Session, PWA, hors ligne, reconnaissance réelle, étude d'une autre cible d'hébergement et publication. Le choix technique minimal du service central et sa sauvegarde/restauration sont indispensables.

## 6. Risques et mesures

| Risque | Mesure | Tâches |
| --- | --- | --- |
| MP3 initiaux toujours publics | Migration vers stockage privé, contrôle des anciennes URL | T032, T066, T067 |
| Rôle contrôlé uniquement dans React | Autorisation serveur sur toutes les opérations | T065, T066 |
| Favoris exposés entre comptes | Propriétaire de session, filtres serveur et essais croisés | T055, T070, T071 |
| Headers forgés/port backend exposé | Frontière proxy explicite et réseau privé si forward auth | T063, T065, T072 |
| Upload partiel/invalide/quota | Zone temporaire privée, validation et publication cohérente | T029, T030 |
| Format importé non lu | Fixtures FLAC/MP3/WAV et arbitrage de variante si nécessaire | T018, T047 |
| Shader coûteux/absent | Optimisation et rendu statique de repli | T041, T048 |
| Attribution historique erronée | Aucun transfert local implicite ; migration admin explicite | T024, T032 |
| Perte base/fichiers | Sauvegarde cohérente et restauration répétée | T073 |

## 7. Livrables

Lecteur et dashboard React ; API ; schéma/migrations ; configuration Authentik/proxy adaptée ; stockage privé ; tests et preuves ; runbook sauvegarde/restauration et livraison. L'absence initiale de Git reste à clarifier avant développement.
