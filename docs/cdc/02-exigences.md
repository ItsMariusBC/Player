# 02 — Exigences fonctionnelles et qualité

Version 1.2. Application React privée, catalogue central administré et favoris individuels. Identifiants historiques conservés, exigences locales/playlists/thèmes remplacées par les décisions utilisateur.

## 1. Programme principal

| ID | Exigence et critère | Tâches | Recette |
| --- | --- | --- | --- |
| F01 | Catalogue commun depuis l'API après autorisation ; migration des 10 titres ; pochette de repli | T027, T032, T037 | R01 |
| F02 | Pas d'autoplay à l'arrivée ; une action explicite lance le média ; refus expliqué | T017, T036 | R02 |
| F03 | États vide, prêt/pause, chargement, lecture, attente, erreur et fin cohérents entre vues | T015–T018, T036, T040 | R03, R04 |
| F04 | Navigation sur la file active, valide avec 0/1/plusieurs titres ; enchaînement et mélange sans perte | T019, T023 | R05 |
| F05 | Choisir un titre le lance ; recherche et ajout à la file préservent le média courant | T019, T037 | R06 |
| F06 | Progression souris/tactile/clavier bornée à la durée ; durée inconnue explicite, aucun NaN | T021, T036, T040 | R07 |
| F07 | Volume/sourdine directement accessibles et compatibles avec la plateforme ; préférence locale si possible | T021, T022, T036 | R08 |
| F08 | Une action par raccourci ; Espace, flèches et M ; aucune interception de saisie/contrôle natif | T020, T023 | R09 |
| F09 | Mini-lecteur synchronisé et désinscription fiable ; ouverture explicite ; aucune donnée d'ancien compte | T016, T040, T071 | R10, R43 |
| F10 | Recherche titre/artiste sans distinction de casse/accents, pagination et état sans résultat | T027, T037 | R11 |
| F11 | Aucune gestion de playlists privées ; anciens parcours retirés sans effacement automatique des valeurs historiques | T026 | R12 |
| F12 | Aucun ajout URL/fichier depuis le lecteur, même admin ; seul le dashboard admin accepte un import | T028, T038, T066 | R13, R39 |
| F13 | Upload admin FLAC/MP3/WAV, contenu validé, bilan par fichier, limites et doublons explicites | T029, T030, T038 | R14, R40 |
| F14 | Médias/pochettes persistés côté serveur privé ; upload partiel non publié, échec non destructif | T025, T029 | R15, R40 |
| F15 | Tags extraits côté serveur et édition admin ; aucune métadonnée inventée | T030, T031, T038 | R17 |
| F16 | Édition/publication/retrait admin avec confirmation et cohérence des références ; retrait interdit les nouvelles lectures | T031, T066, T067 | R18 |
| F17 | Migration idempotente du catalogue initial et sauvegarde ; aucune attribution locale implicite à un compte | T024, T025, T032 | R16, R19 |
| F18 | Un thème violet/shaders ; aucune sélection/création de thèmes ni mode clair/sombre/système ; préférences historiques ignorées | T034, T039, T041 | R20 |
| F19 | Analyseur actif, Canvas adapté, une boucle ; paramètres internes cohérents ; arrêt décoratif/état statique en réduction des mouvements | T041, T042 | R21, R22 |
| F20 | Français, labels et erreurs utiles ; aucun service fictif ni contenu de Menu réintroduit | T028, T043, T044 | R23, R49 |
| F21 | Favoris par compte, persistants entre appareils ; contrainte utilisateur/morceau, ajouts/retraits idempotents et filtre privé | T055, T071 | R31, R42 |
| F27 | Authentik requis ; groupe users ou admin ; sans groupe reconnu refusé | T065, T066, T069 | R38, R39 |
| F28 | Contrôle admin serveur ; appels directs/headers forgés ne contournent pas les droits | T066, T070, T075 | R39, R44 |
| F29 | Dashboard distinct d'import, bilan, correction et gestion du catalogue ; aucun compte/mot de passe local | T029–T031, T038 | R40, R45 |
| F30 | Audio/pochettes privés ; anciennes URL protégées/retirées ; HEAD/Range autorisés et lecture partielle | T032, T067 | R41 |
| F31 | Plein écran/retour du visualiseur, Échap, repli et focus ; aucune relance audio | T076 | R47 |
| F32 | Titres Sheldon Player/SheldonPlayer/Click to Play/ClicktoPlay, animation et Menu/contenus retirés sans déplacement inclus | T028, T043 | R49 |
| F33 | Scrollbar invisible ; molette/trackpad/tactile/clavier et mise en visibilité du focus conservés | T037 | R48 |

Les labels utiles et métadonnées de l'onglet restent possibles. Les commandes fondamentales sont près du morceau ; les anciens réglages du Menu ne sont pas déplacés automatiquement.

## 2. Options non sélectionnées

| ID | Option | Tâche | Recette |
| --- | --- | --- | --- |
| F22 | Export/import personnel de favoris/métadonnées validé ; aucun droit d'import catalogue pour users | T056 | R32 |
| F23 | Media Session si disponible, sans promesse d'arrière-plan universel | T057 | R33 |
| F24 | PWA et mise à jour compatibles avec l'authentification ; aucun cache privé partagé | T058 | R34 |
| F25 | Hors ligne à cadrer avec expiration des droits, cache et nettoyage | T059 | R35 |
| F26 | Étude séparée d'une reconnaissance réelle, sans service/microphone activé | T060 | R36 |

F21 est promue dans le principal. La sauvegarde serveur N12 reste obligatoire sans F22.

## 3. Règles métier

- Identité stable du morceau, distincte de sa position et de l'ID d'occurrence dans la file.
- Une nouvelle demande de piste neutralise les attentes devenues obsolètes.
- Rôle et propriétaire calculés depuis l'identité vérifiée serveur, pas un champ client.
- admin inclut écoute/favoris, sans accès aux favoris d'autrui.
- Upload temporaire privé, publication seulement après validation et référence cohérente.
- Déconnexion/changement de compte : arrêt, nettoyage de l'état personnel et exclusion des réponses réseau obsolètes.
- Reprise locale limitée au compte et en pause ; aucune autorisation conservée dans localStorage.
- Limites d'import et éventuelle variante de décodage restent à préciser ; pas de promesse « tous formats ».
- Retrait de rôle effectif selon une politique de session documentée ; octets déjà reçus non révocables rétroactivement.

## 4. Qualité

| ID | Objectif | Tâches | Recette |
| --- | --- | --- | --- |
| N01 | Installation verrouillée, runtime/gestionnaire uniques ; frontend/API/stockages de dev reproductibles | T009–T014, T064, T072 | R24 |
| N02 | Types, lint, tests et builds frontend/API propres sans affaiblir les contrôles | T012–T014, T023, T033, T070 | R25 |
| N03 | Cible WCAG 2.2 AA : sémantique, noms, focus, erreurs et lecteur d'écran ; audit ciblé distinct d'une certification | T020, T034–T044, T076 | R23, R26 |
| N04 | 360/414/768/1024/1440 px, zoom 200 %, cibles principales 44 px et zones sûres | T035–T040, T044, T076 | R27 |
| N05 | Réduction des mouvements, arrêt décoratif onglet masqué et repli sans WebGL | T041, T042 | R22 |
| N06 | Budget frontend proposé : JS ≤ 300 Kio gzip hors décor différé, CSS ≤ 60 Kio ; API/auth/audio mesurés séparément ; aucun téléchargement complet implicite | T003, T041, T048 | R28 |
| N07 | Cible proposée : retour commande < 100 ms, recherche interne 1000 métadonnées < 100 ms hors réseau/rendu ; ressources stables après 20 cycles | T016, T027, T048 | R10, R11, R28 |
| N08 | Aucun secret/token dans React/preuves ; uploads sur serveur prévu, pas de tiers non choisi | T029, T065, T070 | R29 |
| N09 | Navigateurs D07 avec FLAC/MP3/WAV, streaming authentifié, plein écran et tactile ; émulation distinguée du réel | T047, T074, T076 | R30, R47 |
| N10 | Runbook frontend/API/Authentik, migrations, stockage et récupération ; même référence de code dans les preuves | T052–T054, T072, T073 | R24, R37 |
| N11 | Isolation, expiration/révocation, protection CSRF adaptée à la session ; cache personnel nettoyé | T055, T065, T069–T071 | R42–R44 |
| N12 | Sauvegarde cohérente base/médias et restauration répétée en environnement isolé | T073 | R46 |

Les budgets restent des objectifs à confirmer, pas des résultats mesurés. Le [référentiel WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/) guide contrastes, contrôles et focus. Le seuil tactile 44 px est une règle du projet.
