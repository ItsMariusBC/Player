# 04 — Backlog détaillé et dépendances

## 1. Mode d'emploi

Version 1.2 : 76 tâches, 69 principales et 7 options. T055 rejoint le principal ; T026/T028/T039 retirent les anciens parcours. Descriptions actualisées pour Authentik/admin/favoris.

Chaque ligne est une tâche distincte. Le programme principal T001–T055 et T063–T076 est retenu par D03 ; son exécution reste à planifier après les décisions complémentaires. D01 est enregistrée en T005 ; T006 dispose de l'orientation D02 validée, mais son brief reste à produire. Les autres tâches ne sont pas déclarées réalisées. Les codes d'agents Axx et skills Sxx sont définis dans [Agents et skills](05-agents-et-skills.md). S-UI est désormais résolu : S05 et S06 pour l'interface React. La preuve attendue fait partie de la tâche.

Effort relatif : **S** = modification localisée ; **M** = fonction bornée sur quelques fichiers ; **L** = module ou intégration transversale. Ces tailles ne sont pas des jours ni des délais promis. T007 estime les charges après finalisation des paramètres D04/D05 et indique la capacité disponible ; aucune date de livraison n'est inventée.

Une dépendance désigne une sortie disponible et validée. Les lots regroupent des responsabilités, pas un ordre strict : par exemple, T022 attend T025 du lot données. Les plages de tâches dans une dépendance incluent toutes les tâches de cette plage.

## 2. L0 — Cadrage

| ID | Priorité / effort | Travail et livrable | Dépendances | Agent | Skill | Preuve de fin |
| --- | --- | --- | --- | --- | --- | --- |
| T001 | P0 / M | Cartographier sources, imports, effets, données et fichiers générés ; relever l'absence éventuelle de Git et de tests | Aucune | A01 | S01 | Carte des fichiers, responsabilités et points d'entrée vérifiables |
| T002 | P0 / M | Établir la référence : installation, écran, lecture et défauts A01–A14 ; figer machine, navigateurs et protocole de mesure | T001 | A11 | S04, S07 | Rapport attendu/réel, captures, logs de types/build et défauts reproduits ou non confirmés |
| T003 | P0 / M | Vérifier compatibilités frontend/API/Auth, formats et stockage ; versions exactes et sources officielles | T001 | A02 | S01 | Matrice runtime, OIDC/proxy et notes de migration |
| T004 | P0 / M | Revoir le périmètre multi-utilisateur et finaliser quotas, navigateurs et options | T001–T003 | A03 | S01 | Aucune hypothèse locale/playlist privée maintenue |
| T005 | P0 / S | Décision D01 enregistrée : projet personnel conservé en React, réponse 1A ; contrôler sa prise en compte dans le plan | Décision utilisateur reçue | A00 | S01 | Accord explicite enregistré ; impacts React appliqués, aucune migration Svelte prévue |
| T006 | P1 / M | Détailler le brief D02 : identité Sheldon et dominante violette conservées, hiérarchie modernisée, tokens et contraintes de mouvement | T004, T005 | A00 | S-UI, S01 | Brief finalisé dans l'orientation 2A, tokens issus du projet et contrastes vérifiés |
| T007 | P0 / M | Planifier React + serveur, fichiers, charges et jalons | T004–T006, T063 | A04 | S01 | Plan startable incluant identité et médias privés |
| T008 | P0 / S | Faire relire le plan et corriger ses lacunes par le planificateur ou A00 | T007 | A05 | S01 | Verdict de revue et résolution des points bloquants ; plan de référence intégré au CDC |

## 3. L1 — Outillage et dépendances

| ID | Priorité / effort | Travail et livrable | Dépendances | Agent | Skill | Preuve de fin |
| --- | --- | --- | --- | --- | --- | --- |
| T009 | P0 / M | Fixer gestionnaire/runtime D05 ; produire un lockfile de référence et une procédure d'installation propre ; conserver une copie des anciens verrous avant consolidation | T008, D05 | A07 | S08 | R24 : installation verrouillée depuis une copie propre, sans dépendances natives copiées |
| T010 | P0 / M | Adapter progressivement la structure React/Vite existante ; préciser les responsabilités, les éventuels déplacements et la sortie statique | T009, D01 | A08 | S01, S03 | Démarrage et build observés ; structure documentée et initialisation client maîtrisée |
| T011 | P0 / L | Mettre à jour les dépendances par groupes compatibles ; retirer celles devenues inutiles ; figer versions et justifications | T003, T010 | A07 | S03 | Installation/build par palier et matrice réelle mise à jour ; aucun conflit ignoré |
| T012 | P0 / M | Ajouter scripts de types, lint et tests ; configurer runners retenus et fixtures synthétiques ; séparer tests domaine/navigateur | T011, D05 | A07 | S08 | Commandes exécutables et premier contrôle utile ; aucune erreur préexistante masquée |
| T013 | P0 / S | Corriger A01 dans le composant React ; traiter les diagnostics de la structure modernisée | T010–T012 | A06 | S03 | R25 : contrôle des types propre, sans suppression de règle ni cast de contournement |
| T014 | P1 / M | Préparer la CI locale/reproductible : installation, types, lint, tests, build et conservation des rapports ; configuration distante seulement si dépôt identifié | T012, T013 | A07 | S08 | Pipeline validé sur dépôt disponible, ou commandes équivalentes exécutées localement avec limite documentée |

## 4. L2 — Moteur et commandes

| ID | Priorité / effort | Travail et livrable | Dépendances | Agent | Skill | Preuve de fin |
| --- | --- | --- | --- | --- | --- | --- |
| T015 | P0 / L | Définir types de morceau/source/file, états, commandes asynchrones, erreurs et contrat d'abonnement | T011, T013 | A08 | S02 | Contrat relu par consommateurs UI/données ; invalides et durée inconnue représentables sans ambiguïté |
| T016 | P0 / L | Remplacer les callbacks écrasés par abonnements désinscriptibles ; fournir l'adaptation réactive React | T015 | A08 | S02, S03 | R10 : plusieurs consommateurs simultanés, démontage isolé et absence de listeners résiduels |
| T017 | P0 / L | Refaire le cycle de vie audio : geste, contexte, analyseur actif, lecture/pause, attentes annulables et destruction ; prévenir les courses de piste | T015, T016 | A08 | S03, S04 | R02–R04 : média réel, activation unique et commandes rapides ; ressources nettoyées |
| T018 | P0 / M | Traiter refus de session, réseau, codec et streaming ; vérifier FLAC/MP3/WAV privés | T017, T067 | A07 | S02 | R04/R30 : erreur récupérable puis média valide |
| T019 | P0 / L | Corriger navigation et remplacement de file ; identités stables, vide/un titre, enchaînement, mélange et conservation de l'entrée courante | T015, T017 | A08 | S03, S04 | R05/R06 : files de 0, 1, 3 et 12 entrées, modes en pause/en lecture, aucun titre perdu |
| T020 | P0 / M | Unifier raccourcis ; gérer saisie, contrôles natifs, modales, répétition de touche et nettoyage | T016, T019 | A07 | S06, S04 | R09 : une action par touche et saisie intacte dans les formulaires |
| T021 | P1 / M | Implémenter commandes bornées de progression, volume et sourdine ; exposer capacité/état aux vues | T017, T019 | A07 | S02, S06 | R07/R08 : durée inconnue, limites, interaction clavier/tactile et politique mobile |
| T022 | P1 / M | Restaurer une reprise en pause limitée au compte et les préférences autorisées | T017, T019, T021, T069, T071 | A07 | S02 | R19/R43 : aucun ancien compte ni autoplay |
| T023 | P0 / M | Écrire et exécuter les régressions du domaine audio/file/clavier, dont A02–A04 et concurrence de commandes | T018–T022, T012 | A07 | S04 | Suite déterministe et parcours média réel ; tests sensibles au défaut plutôt qu'au détail d'implémentation |

## 5. L3 — Données et bibliothèque

| ID | Priorité / effort | Travail et livrable | Dépendances | Agent | Skill | Preuve de fin |
| --- | --- | --- | --- | --- | --- | --- |
| T024 | P0 / L | Schéma central utilisateurs/catalogue/favoris ; migration et archive des anciennes données sans attribution implicite | T015, T068 | A08 | S02, S01 | Mapping stable/idempotent, aucun modèle de playlist privée |
| T025 | P0 / L | Migrations et dépôts serveur catalogue/médias/identités/favoris ; transactions et contraintes | T024, T064 | A08 | S02, S03 | DB réelle et échecs non destructifs ; pas d'IndexedDB central |
| T026 | P1 / M | Retirer parcours/services de playlists privées ; préserver les données historiques récupérables | T024, T028 | A07 | S03 | R12 : UI/API absentes, aucune suppression implicite |
| T027 | P1 / M | Recherche/pagination serveur et normalisation titre/artiste ; état sans résultat | T025, T068 | A07 | S02, S03 | R11 : 1000 métadonnées, filtres validés et lecture préservée |
| T028 | P1 / M | Retirer services/parcours users d'ajout URL/fichier et reconnaissance simulée | T015 | A07 | S03 | R13 : anciens ajouts indisponibles et données préservées |
| T029 | P1 / L | Upload admin FLAC/MP3/WAV, zone privée temporaire, doublons et publication cohérente | T025, T030, T066, D04 | A08 | S02, S03, S10 | R14/R15/R40 : valides, invalides, quota et interruption |
| T030 | P1 / M | Tags/pochettes serveur ; type réel FLAC/MP3/WAV et valeurs de remplacement explicites | T015, T064, D04 | A07 | S03 | R17/R40 : taggé, absent et malformé sans invention |
| T031 | P1 / M | Édition/publication/retrait admin et cohérence des favoris associés | T025, T029, T066 | A07 | S02, S03 | R18/R45 : droits, annulation et retrait |
| T032 | P0 / M | Importer les 10 titres dans le stockage privé avec IDs stables ; fermer/protéger les anciennes URL publiques | T025, T029 | A07 | S03 | R01/R16/R41 : import idempotent et aucun média public |
| T033 | P0 / M | Tests transactions, migration, import, recherche et retrait du catalogue central | T025, T027, T029–T032, T012 | A07 | S04, S11 | DB/fichiers réels de test, interruption et reprise |

## 6. L4 — Interface et visualisation

| ID | Priorité / effort | Travail et livrable | Dépendances | Agent | Skill | Preuve de fin |
| --- | --- | --- | --- | --- | --- | --- |
| T034 | P1 / L | Définir les tokens du thème unique violet avec shaders et composants React réutilisables ; améliorer les primitives existantes | T006, T010, T011 | A08 | S-UI | Palette unique, contrastes et identité conservés ; aucun mode alternatif |
| T035 | P1 / L | Structure lecteur authentifié/dashboard admin, états vide/attente/refus | T016, T025, T034, T069 | A08 | S-UI | R01/R27/R38 : données après accès seulement |
| T036 | P1 / M | Intégrer lecteur principal, commandes visibles, progression interactive et noms accessibles | T017–T021, T035 | A07 | S-UI | R02/R03/R07/R08 et navigation clavier sur le média réel |
| T037 | P1 / M | Catalogue/file/recherche/favoris ; scrollbar masquée, molette/tactile/clavier/focus conservés | T019, T027, T035, T055 | A07 | S-UI | R06/R11/R31/R48 : tous les titres accessibles |
| T038 | P1 / L | Dashboard admin upload/gestion du catalogue, bilan par fichier et édition des tags | T029–T031, T035, T066 | A08 | S-UI | R40/R45 : parcours réel et refus users UI/API |
| T039 | P1 / M | Retirer modes clair/sombre/système et sélecteurs/création de thèmes ; palette unique avec shaders | T034 | A07 | S-UI | R20 : aucun contrôle ni ancienne préférence réappliquée |
| T040 | P1 / M | Mini-lecteur synchronisé/zones sûres ; nettoyage à la déconnexion ou expiration | T016, T021, T022, T035 | A07 | S-UI | R10/R43 : 20 cycles, aucun résidu entre comptes |
| T041 | P1 / L | Analyseur, boucle Canvas et shaders du thème unique ; paramètres internes, DPR et repli statique | T017, T034 | A08 | S03, S-UI | R21/R22/R28 : une boucle, aucun menu réintroduit |
| T042 | P1 / M | Transitions/notifications, réduction des mouvements et ressources ; cohérence avec le plein écran | T035, T039–T041, T076 | A07 | S-UI | R22/R47 : aucune relance audio ni boucle résiduelle |
| T043 | P1 / S | Retirer titres Sheldon Player/Click to Play/variantes et animation ; supprimer Menu/contenus ; labels utiles | T028, T036–T042 | A06 | S-UI | R23/R49 : absents sans espace vide ni déplacement implicite |
| T044 | P1 / M | Auditer clavier, focus, contrastes, lecteur d'écran, zoom, scroll et plein écran du lecteur/dashboard | T020, T036–T043, T076 | A11 | S06, S07 | R23/R26/R27/R47/R48 avec écarts précis |
| T045 | P1 / S | Vérifier tokens et composants réels, cohérence du design et fidélité à l'identité Sheldon violette D02 | T034–T044 | A10 | S05, S06 | Rapport fondé sur code, référence initiale et captures ; amélioration responsive sans perte d'identité |

## 7. L5 — Recette et livraison locale

| ID | Priorité / effort | Travail et livrable | Dépendances | Agent | Skill | Preuve de fin |
| --- | --- | --- | --- | --- | --- | --- |
| T046 | P0 / L | Parcours E2E lecteur/admin/favoris sur API réelle ; fixtures isolées et auth simulée distinguée du réel | T023, T033, T043, T044, T055, T070 | A07 | S07, S11 | Rapport E2E et contrôles d'isolation/accès négatif |
| T047 | P1 / M | Recette manuelle indépendante Chrome/Firefox/Safari et appareils disponibles ; vérifier audio, tactile, focus et limites de plateforme | T046, D07 | A11 | S07, S06 | R30 et matrice versions/appareils ; tests non exécutés clairement identifiés |
| T048 | P1 / M | Mesurer frontend/API/auth, requêtes, streaming, recherche et ressources ; corriger les écarts sur périmètres réservés | T046, T041, D07 | A08 | S07, S03 | R28 : mêmes conditions de mesure, budget tenu ou arbitrage explicite |
| T049 | P0 / M | Revue finale frontend/API/audio/données et tests | T014, T046–T048, T075 | A09 | S03, S02 | Findings sur le livrable complet |
| T050 | P0 / M | Traiter les anomalies de revue et de recette ; réserver les fichiers au propriétaire du domaine avant correction | T045, T049 | A08 | S04, S03 | Régressions reproduites puis corrigées avec preuve ; s'il n'y a pas d'anomalie, constater ce résultat sans modification artificielle |
| T051 | P0 / M | Rejouer la recette affectée sur le code corrigé, puis la suite obligatoire et les parcours finaux | T050 | A11 | S07 | Rapport de recette à jour sur une seule référence de code, aucune anomalie bloquante |
| T052 | P1 / M | Runbook frontend/API/Authentik, médias privés, migrations et récupération | T051, T072, T073 | A06 | S08 | R24/R37/R46 : commandes vérifiées, sans secrets |
| T053 | P0 / S | Porte finale incluant auth réelle, isolation, médias et restauration | T045, T049, T051, T052, T073, T074 | A12 | S01 | Verdict sur même version ; mocks auth seuls insuffisants |
| T054 | P0 / S | Remettre la version locale, le bilan, le registre des décisions et les commandes de lancement ; faire constater la livraison | T053 | A00 | S01 | Application accessible, démonstration des parcours et dossier de preuve complet ; publication séparée |


## 8. Serveur, Authentik et fonctionnalités promues

T055 fait partie du programme principal. Les dépendances gouvernent l'ordre réel.

| ID | Priorité / effort | Travail et livrable | Dépendances | Agent | Skill | Preuve de fin |
| --- | --- | --- | --- | --- | --- | --- |
| T055 | P0 / M | Favoris serveur du compte et actions React ; unicité, filtre, ajout/retrait idempotents | T025, T035, T066, T068 | A07 | S02, S-UI | R31/R42 : persistance multi-navigateur et isolation A/B |
| T063 | P0 / M | Finaliser infrastructure/proxy/mode Authentik, mappings groupes, quotas, DB et stockage | T003, T004 | A00 | S01, S10 | D04/D06/D09 concrètes, sans secret ni modification externe |
| T064 | P0 / L | Créer API, configuration et interfaces DB/stockage ; secrets serveur | T011, T063, T068 | A08 | S02, S03 | Démarrage, validation de config et builds |
| T065 | P0 / L | Authentik choisi : OIDC serveur ou frontière forward auth ; session/expiration/logout | T064, D09 | A08 | S10 | R38/R43/R44 avec provider/proxy réel |
| T066 | P0 / L | Droits users/admin serveur sur chaque surface ; refus par défaut et pas de contournement proxy | T065, T068 | A08 | S10, S02 | R39 : anonyme/sans groupe/users/admin/appels directs |
| T067 | P0 / L | Audio/pochettes privés, autorisation HEAD/Range et cache ; anciennes URL | T025, T032, T066 | A08 | S02, S10 | R41 : 206/416 adaptés, seek et refus sans droit |
| T068 | P0 / M | Contrats HTTP catalogue/admin/favoris/session/médias, erreurs/pagination/limites | T015, T063 | A08 | S02 | Schémas relus ; aucun propriétaire choisi côté client |
| T069 | P0 / M | Identité/permissions/logout React ; expiration, arrêt audio et retour de connexion | T016, T065, T066 | A07 | S10, S-UI | R38/R43 : état protégé et changement sans résidu |
| T070 | P0 / L | Tests HTTP/RBAC/CSRF adapté/upload/médias et favoris croisés | T029, T031, T055, T066–T068 | A07 | S11, S04, S10 | R39–R44 sur vrai backend ; limites des mocks indiquées |
| T071 | P0 / M | Isoler cache, réponses tardives, reprise et état personnel au changement de compte | T055, T069 | A08 | S10, S03 | R42/R43 : aucune donnée A visible par B |
| T072 | P0 / M | Configuration exploitation frontend/API/proxy, réseau privé, volumes et healthchecks | T064, T065, T067, D06 | A08 | S08, S10 | Configuration revue et ports fermés, sans publication implicite |
| T073 | P0 / M | Sauvegarde base/médias et restauration/rollback sur environnement isolé | T025, T029, T032 | A08 | S08 | R46 : fichiers/catalogue/favoris restaurés |
| T074 | P0 / M | Recette réelle Authentik users/admin/sans groupe, proxy/cookies/révocation | T046, T072, D09 | A11 | S07, S10 | R38–R44 ; absence d'environnement = non vérifié |
| T075 | P0 / M | Revue indépendante identité/droits/fichiers/cache/propriété favoris | T070, T071, T072, T074 | A09 | S10, S11 | Rapport auth/serveur rattaché au code |
| T076 | P1 / M | Plein écran visualiseur : Échap/sortie native, repli, Canvas et focus | T035, T041 | A07 | S-UI, S07 | R47 : cycles sans relance ni perte de contrôle |

## 9. Options — Activation par D08

| ID | Priorité / effort | Travail et livrable | Dépendances | Agent | Skill | Preuve de fin |
| --- | --- | --- | --- | --- | --- | --- |
| T056 | P2 / L | Export/import personnel favoris/métadonnées ; aucun droit d'upload catalogue users | T054, D08 | A08 | S02, S-UI | R32 : validation/annulation et absence d'élévation |
| T057 | P2 / M | Intégrer Media Session avec détection de capacités, nettoyage et commandes système | T054, D08 | A07 | S02 | R33 sur plateforme supportée et sans API ; pas de promesse de lecture en arrière-plan |
| T058 | P2 / L | Ajouter manifeste, icônes, installation et cycle de mise à jour PWA, cache de structure maîtrisé | T054, D08 | A08 | S08, S-UI | R34 : installation si supportée, mise à jour sans interruption cachée et désinstallation/cache documentés |
| T059 | P2 / L | Ajouter sélection hors ligne, stockage/cache, quotas, suppression et cohérence des versions | T058, D08 | A08 | S02 | R35 : seuls les titres choisis disponibles sans réseau ; aucun téléchargement complet implicite |
| T060 | P2 / M | Étudier reconnaissance réelle, données traitées, coûts vérifiés et besoin de backend ; proposer un CDC séparé si retenu | T054, D08 | A02 | S01 | R36 : étude sourcée avec limites et décision ; aucun service activé |
| T061 | P2 / S | Étudier une autre cible d'hébergement si demandée ; base actuelle traitée en T063 | T054, D06, D08 | A02 | S01, S08 | Étude sourcée sans ressource créée |
| T062 | P2 / M | Publication sur cible/Auth/proxy explicitement autorisés ; vérifier anciennes URL et accès | T054, T072–T074, autorisation de publication | A00 | S08 | URL privée vérifiée et récupération disponible |

Chaque option de développement repasse par revue, recette et porte de livraison sur sa propre version : les contrôles T049–T054 sont réappliqués au périmètre modifié. Une étude T060/T061 se termine par un document et ne déclenche pas l'implémentation étudiée.

## 10. Chemin d'exécution

Cadrage et infrastructure T001–T008/T063 ; outillage T009–T015 ; contrats API T068 puis service/identité T064–T066 ; stockage T024/T025 ; import/médias T029/T032/T067 ; adaptation React T069 et interface T034/T035 ; favoris T055 et isolation T071 ; moteur/commandes/ajustements UI selon les dépendances ; tests T023/T033/T070/T046 ; exploitation/restauration T072/T073 ; Authentik réel T074 ; revues T075/T049 ; corrections, recette et livraison T050–T054.

T076 précède la validation finale UI. Les tableaux font foi ; aucune réalisation n'est annoncée par ce schéma.

## 11. Suivi et critères de passage

Pour chaque tâche en réalisation, maintenir : statut, décisions d'entrée, agent affecté, fichiers réservés, date, référence du code, commande/scénario exécuté, lien vers la preuve et éventuelle réserve. Si le périmètre D03 change, retirer ou reporter explicitement les tâches exclues et mettre à jour les exigences et la recette ensemble.

Le passage d'un lot à l'autre ne justifie jamais d'ignorer un contrôle en échec. Une anomalie bloquante empêche l'acceptation de la tâche concernée. Les points hors périmètre sont documentés et ne deviennent pas des développements supplémentaires automatiques.
