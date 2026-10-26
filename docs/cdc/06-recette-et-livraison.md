# 06 — Recette et livraison

Version 1.2. Tous les scénarios ci-dessous sont à exécuter pendant la réalisation. Seuls le lancement Chrome limité et l'échec TypeScript rapportés dans l'état initial ont déjà été observés.

## 1. Préconditions

- Environnement isolé reproductible : frontend, API, base et stockage privés.
- Comptes de test Authentik users, admin, sans groupe et deux comptes ordinaires A/B.
- Build de production local pour recette finale et mesures ; versions OS/navigateur/runtime consignées.
- Catalogue initial de 10 titres ; files de 0/1/3/12 entrées ; 1000 métadonnées synthétiques.
- Fixtures FLAC/MP3/WAV valides, sans tags, malformées, doublons et fichiers hors limites.
- Erreurs contrôlées : 401/403/404, plage invalide, interruption upload/réseau, quota et base indisponible.
- Anciennes données locales synthétiques, jamais les données personnelles courantes pour simuler une migration.
- Authentik simulé réservé aux tests déterministes ; la recette réelle T074 reste distincte et obligatoire.
- Navigateurs/appareils D07 ; émulation de viewport distinguée d'un appareil physique.

## 2. Scénarios principaux

| ID | Action | Attendu | Exigences |
| --- | --- | --- | --- |
| R01 | Compte autorisé, charger le catalogue et une pochette absente | 10 titres migrés/résolus et repli d'image ; aucun catalogue avant accès | F01 |
| R02 | Arriver sans lecture, puis action explicite | Silence initial puis média réel ; refus navigateur expliqué | F02 |
| R03 | Lire/pauser/reprendre/changer de piste avec mini-lecteur | État, titre et temps cohérents ; aucune ancienne piste relancée | F03 |
| R04 | Erreur de flux/session/codec puis titre valide | État correct, choix de reprise, pas de tentatives infinies | F03 |
| R05 | Navigation/fin/mélange sur files 0/1/3/12 | Indices valides, file réelle, courant conservé, aucun titre perdu | F04 |
| R06 | Sélection puis ajout à la file/recherche | Sélection explicite lance ; autres actions conservent le média | F05 |
| R07 | Seek souris/clavier/tactile et durée inconnue | Position bornée, événements réels et contrôle indisponible si nécessaire | F06 |
| R08 | Volume/sourdine/rechargement et plateforme à volume système | État honnête et préférence si possible | F07 |
| R09 | Espace/M/flèches puis saisie/contrôle natif | Une action ; aucun caractère volé ; slider natif conservé | F08 |
| R10 | Ouvrir/fermer 20 fois le mini-lecteur | Même état, pas d'abonnement/notification supplémentaire | F09, N07 |
| R11 | Rechercher casse/accents/absent sur 1000 entrées | Résultats paginés corrects, état vide, lecture conservée, mesure | F10, N07 |
| R12 | Chercher les anciens parcours playlists | Aucune UI/API de playlist privée ; données historiques non effacées automatiquement | F11 |
| R13 | Chercher les ajouts URL/fichiers du lecteur ; appeler ancien parcours | Aucune entrée d'ajout ; aucune mutation non autorisée | F12 |
| R14 | Upload admin multiple avec valide/invalide/doublon/hors limite | Bilan par fichier, contenu vérifié, aucun succès effacé | F13 |
| R15 | Interrompre upload/remplir quota/refuser stockage | Pas de média public ni entrée partielle jouable ; reprise contrôlée | F14 |
| R16 | Import initial, interruption puis réexécution | IDs/références cohérents, idempotence et sauvegarde récupérable | F17 |
| R17 | FLAC/MP3/WAV avec/sans tags, puis édition admin | Métadonnées réelles ou remplacement explicite, aucune invention | F15 |
| R18 | Annuler puis confirmer un retrait admin | Annulation intacte ; référence/favoris traités ; nouvelle lecture refusée | F16 |
| R19 | Recharger une reprise puis changer de compte | Reprise bornée/en pause du seul compte ; aucun transfert local implicite | F17, N11 |
| R20 | Inspecter UI et anciennes préférences de thème | Un seul thème/shaders ; aucun sélecteur ni mode automatique | F18 |
| R21 | Signal audio, changement de source et resize | Analyseur actif, une boucle, Canvas/DPR cohérents | F19 |
| R22 | Réduction des mouvements, onglet masqué, WebGL absent | Décor arrêté/statique et commandes fonctionnelles ; aucune boucle supplémentaire | N05 |
| R23 | États vide/attente/refus/erreur et noms accessibles | Français cohérent, erreurs utiles et annonces modérées | F20, N03 |
| R24 | Installer copie propre et lancer frontend/API | Lockfile/runtime uniques, services requis documentés | N01, N10 |
| R25 | Types/lint/tests/builds frontend/API | Tous propres, aucun contrôle affaibli | N02 |
| R26 | Parcours clavier/lecteur d'écran, modales et focus | Sémantique, labels, contrastes et absence de piège | N03 |
| R27 | Largeurs 360/414/768/1024/1440, zoom 200 %, tactile | Lecteur/dashboard utilisables, cibles 44 px, aucun débordement | N04 |
| R28 | Mesurer build, auth/API, flux et ressources | Budget documenté, pas de préchargement complet ni multiplication de boucles | N06, N07 |
| R29 | Inspecter trafic/logs/frontend pendant upload | Aucun secret client ni transmission vers un tiers non choisi | N08 |
| R30 | Lire vraiment FLAC/MP3/WAV sur navigateurs/appareils D07 | Décodage/seek validés ; lacunes explicites, pas de simple test d'extension | N09 |
| R31 | Ajouter/retirer favori, recharger/autre navigateur même compte | État persistant côté serveur et idempotent | F21 |
| R37 | Suivre runbook et rapprocher preuves/livrable | Même référence de code, retour/récupération documentés | N10 |
| R38 | Accès anonyme, connexion, retour et expiration | Authentik requis ; aucun catalogue/média privé avant autorisation | F27 |
| R39 | Matrice anonyme/sans groupe/users/admin, UI et appels directs | Seuls users/admin écoutent ; seul admin gère catalogue | F27, F28 |
| R40 | Upload admin FLAC/MP3/WAV et falsification extension/MIME | Contenu validé, quota et droits ; échec partiel non destructif | F13, F29 |
| R41 | GET/HEAD/Range autorisé/non autorisé et anciennes URL | Flux privé, 206/416 adaptés, seek réel ; aucun contournement public | F30 |
| R42 | Favoris A/B depuis deux clients ; tenter userId/ID d'autrui | Isolation stricte, y compris admin ; unicité/idempotence | F21, N11 |
| R43 | Logout A, login B, requête A tardive et audio en tampon | État A vidé, réponse tardive exclue, arrêt à déconnexion connue | N11 |
| R44 | Retirer un groupe, expirer session, forger headers et tenter CSRF | Refus selon politique documentée ; aucune frontière de confiance contournée | F28, N11 |
| R45 | Dashboard : importer, vérifier tags, publier, corriger, retirer | Parcours admin complet ; users refusés à chaque mutation | F29 |
| R46 | Restaurer sauvegarde base+médias isolée | Catalogue, fichiers, références et favoris cohérents | N12 |
| R47 | Plein écran/retour/Échap/refus API sur visualiseur | Canvas/focus adaptés ; repli annoncé ; aucune relance audio | F31 |
| R48 | Défilement liste molette/trackpad/tactile/clavier | Scrollbar invisible mais tous les titres/focus accessibles | F33 |
| R49 | Inspecter lecteur, DOM visible et anciens déclencheurs | Titres/animation/Menu/contenus absents ; labels utiles conservés | F20, F32 |

R03/R05 incluent des changements rapides pendant le chargement : seule la dernière demande peut lancer la piste.

## 3. Scénarios optionnels non sélectionnés

| ID | Action | Attendu |
| --- | --- | --- |
| R32 | Export/import personnel, version invalide et annulation | Données propres au compte ; aucune importation catalogue users |
| R33 | Media Session supportée/absente | Actions correctes si supportées et aucune régression sinon |
| R34 | Installation/mise à jour PWA | Auth préservée, données privées non partagées, aucune interruption cachée |
| R35 | Hors ligne choisi puis expiration/logout | Politique de droits/cache explicitement validée avant implémentation |
| R36 | Lire l'étude reconnaissance | Faisabilité/sources/limites, aucun service activé |

## 4. Méthodes et preuves

Tests du domaine : indices, désabonnements, concurrence et annulation. Tests d'intégration : base réelle isolée, fichiers, transactions, schémas HTTP, droits et propriété. Les mocks de stockage/Auth ne prouvent pas l'intégration provider/proxy, les cookies HTTPS ou le décodage réel.

Parcours navigateur : locateurs sémantiques, attente enregistrée avant l'action (playing/timeupdate/seeked, état réseau/DB ou état UI), limite bornée, sans sommeil fixe pour espérer une transition.

Captures du thème unique aux cinq largeurs, dont refus, erreur, dashboard, mini-lecteur et visualiseur agrandi. Comparaison à l'identité et aux composants réels ; pas de variantes clair/sombre à livrer.

Preuves futures dans docs/cdc/preuves/<tache>/ : tâche/exigences, date, environnement, entrée synthétique, commande/action, résultat, limites et référence du code. SHA complet si Git existe ; sinon manifeste/empreinte. Pas de profils personnels, secrets, tokens ou médias privés dans les rapports.

## 5. Jalons

| Jalon | Sortie attendue |
| --- | --- |
| J0 | Décisions fonctionnelles consignées et infrastructure/Auth/quotas suffisamment précis |
| J1 | Installation, outils, types et builds propres |
| J2 | API, Authentik, rôles et stockage privé fonctionnels |
| J3 | Import/catalogue central, favoris et lecture intégrés |
| J4 | Dashboard et ajustements UI accessibles et performants |
| J5 | Recette réelle, revue, restauration et livraison locale documentées |
| J6 | Publication éventuelle sur cible explicitement autorisée |

Démonstrations intermédiaires par étapes sans retirer les fonctionnalités confirmées de la livraison finale.

## 6. Acceptation et récupération

Bloquant : perte de données, bypass Auth/RBAC, fuite entre comptes, médias publics, démarrage impossible. Majeur : lecture/import/catalogue/favoris cassé ou parcours principal inaccessible. Ces anomalies refusent la livraison.

Un scénario non exécuté n'est jamais déclaré passant. Un environnement Authentik ou appareil manquant reste non vérifié jusqu'à exécution ou révision explicite du périmètre.

Checklist future :

- [ ] Décisions D01–D11 et version livrée consignées.
- [ ] Installation et builds frontend/API propres.
- [ ] Types, lint, tests métier/HTTP/E2E exécutés.
- [ ] Intégration Authentik réelle et droits vérifiés.
- [ ] Médias directs privés et isolation favoris prouvés.
- [ ] Upload FLAC/MP3/WAV et lecture réels sur cibles retenues.
- [ ] Thème unique, titres/Menu retirés, scroll et plein écran vérifiés.
- [ ] Accessibilité et performance mesurées.
- [ ] Sauvegarde/restauration base+médias démontrée.
- [ ] Revues et recette sur la même référence de code.
- [ ] Application locale accessible et bilan remis.

Le retour du code seul ne convertit pas les nouvelles données. Le runbook distingue rollback applicatif, restauration de base et récupération de fichiers. Publication/configuration réelle Authentik/proxy nécessitent une autorisation sur une action concrète préparée.
