# 05 — Agents, skills et organisation

## 1. Portée de cette attribution

Les noms ci-dessous correspondent aux rôles réellement disponibles dans cette session. Version 1.2 : les affectations incluent désormais API, Authentik, stockage privé et favoris individuels. Il s'agit d'une affectation pour les futurs travaux ; aucun sous-agent n'est lancé pendant la rédaction du CDC. Le même rôle peut recevoir plusieurs missions successives avec des instances distinctes.

Le responsable du projet reste décisionnaire sur le produit. L'agent racine coordonne, intègre et rend compte ; il ne remplace pas une validation utilisateur par un verdict d'agent.

## 2. Catalogue des agents retenus

| Code | Agent réel | Mission attribuée | Tâches |
| --- | --- | --- | --- |
| A00 | `/root` — agent principal | Décisions avec l'utilisateur, coordination, intégration et livraison | T005, T006, T054, T062, T063 |
| A01 | `explorer` | Inventaire du code et cartographie des impacts, en lecture seule | T001 |
| A02 | `librarian` | Sources officielles, dépendances, compatibilités et études externes, en lecture seule | T003, T060, T061 |
| A03 | `metis` | Ambiguïtés, périmètre, risques, décisions manquantes, en lecture seule | T004 |
| A04 | `plan` | Plan exécutable avec dépendances et périmètres de fichiers ; aucune implémentation | T007 |
| A05 | `momus` | Revue du plan : chaque tâche peut démarrer et possède une validation concrète ; lecture seule | T008 |
| A06 | `lazycodex-worker-low` | Corrections localisées, textes et documentation bornée | T013, T043, T052 |
| A07 | `lazycodex-worker-medium` | Fonctions dans des couches existantes et intégrations limitées | T009, T011, T012, T014, T018, T020, T021, T022, T023, T026, T027, T028, T030, T031, T032, T033, T036, T037, T039, T040, T042, T046, T055, T057, T069, T070, T076 |
| A08 | `lazycodex-worker-high` | Architecture React, contrats, concurrence audio, migration des données, stockage et modules transversaux | T010, T015, T016, T017, T019, T024, T025, T029, T034, T035, T038, T041, T048, T050, T056, T058, T059, T064, T065, T066, T067, T068, T071, T072, T073 |
| A09 | `lazycodex-code-reviewer` | Revue indépendante de correction, maintenabilité et tests, en lecture seule | T049, T075 |
| A10 | `lazycodex-clone-fidelity-reviewer` | Revue du système de design réel : tokens, composants et fidélité à l'identité Sheldon violette ; lecture seule | T045 |
| A11 | `lazycodex-qa-executor` | Recette par usage réel, scénarios négatifs, preuves et anomalies | T002, T044, T047, T051, T074 |
| A12 | `lazycodex-gate-reviewer` | Vérifier la couverture des exigences, la fraîcheur des preuves et les réserves ; lecture seule | T053 |

Les rôles `default` et `worker` génériques existent également. Ils ne sont pas nécessaires au plan initial : les workers dimensionnés rendent la responsabilité plus explicite. Les agents spécialisés sans rapport avec le lecteur ne sont pas mobilisés pour remplir artificiellement une équipe.

## 3. Skills attribués

Les skills S01–S08, S10 et S11 sont présents dans l'environnement. Leurs fichiers ont été consultés pour vérifier leur portée. L'agent chargé d'une future tâche lit le skill complet et ses références nécessaires avant de l'appliquer. Les exemples d'un skill ne créent pas une obligation de changer de framework, d'installer un service ou de publier.

| Code | Skill / source réelle | Usage précis dans le plan |
| --- | --- | --- |
| S01 | [`architecture`](/Users/marius.b/.codex/skills/architecture/SKILL.md) | Exigences, alternatives, frontières des modules, décisions et risques |
| S02 | [`api-and-interface-design`](/Users/marius.b/.codex/skills/api-and-interface-design/SKILL.md) | Contrats TypeScript entre moteur, UI et données ; états, erreurs et validation aux frontières. Couvre désormais les contrats HTTP du catalogue, de l'administration et des favoris en plus des modules internes. |
| S03 | [`clean-code`](/Users/marius.b/.codex/skills/clean-code/SKILL.md) | Refactorisation ciblée et implémentation lisible, sans nouvelle abstraction injustifiée |
| S04 | [`bug-repro-plan`](/Users/marius.b/.codex/skills/bug-repro-plan/SKILL.md) | Reproduction minimale, attendu/réel et tests de régression déterministes |
| S05 | [`baseline-ui`](/Users/marius.b/.codex/skills/baseline-ui/SKILL.md) | Hiérarchie, lisibilité, états et cohérence des primitives dans la voie React explicitement retenue |
| S06 | [`accessibility-basic-check`](/Users/marius.b/.codex/skills/accessibility-basic-check/SKILL.md) | Labels, sémantique, contrastes, clavier et focus ; complément d'une recette WCAG, pas certification |
| S07 | [`browser-automation`](/Users/marius.b/.codex/skills/browser-automation/SKILL.md) | Parcours navigateur, assertions sur état observable, attentes bornées et preuves |
| S08 | [`ci-cd-and-automation`](/Users/marius.b/.codex/skills/ci-cd-and-automation/SKILL.md) | Scripts, contrôles CI et préparation de livraison ; aucune publication implicite |
| S09 | `muse` — règle utilisateur fournie dans les instructions `AGENTS.md` de la session | Examinée pour la comparaison initiale ; non applicable au projet personnel React confirmé par D01 ; aucune tâche attribuée |
| S10 | [`auth-implementation-patterns`](/Users/marius.b/.codex/skills/auth-implementation-patterns/SKILL.md) | Intégration Authentik, frontière d'identité, sessions, RBAC, propriété et révocation |
| S11 | [`api-contract-testing`](/Users/marius.b/.codex/skills/api-contract-testing/SKILL.md) | Schémas et comportement HTTP fournisseur/consommateur ; succès, erreurs et compatibilité. Complété par des tests de droits réels. |

Pour S09, aucun chemin vers un `SKILL.md` autonome n'a été fourni dans le catalogue. Ne pas en inventer un. Sources examinées : [charte locale](/Users/marius.b/.codex/muse/lib/CHARTE.md), [exports réels](/Users/marius.b/.codex/muse/lib/src/lib/index.ts), [tokens](/Users/marius.b/.codex/muse/lib/src/lib/styles/tokens.css). Elles restent une référence historique de l'arbitrage, sans intégration prévue.

### Convention S-UI

Dans le backlog, **S-UI = S05 (`baseline-ui`) + S06 (`accessibility-basic-check`)**, conformément à la décision React 1A. Cet alias documentaire est résolu et n'introduit aucun skill supplémentaire.

Les instructions utilisateur et l'identité validée priment sur les préférences génériques de S05. La dominante violette et les éléments identitaires conservés par la réponse 2A ne sont pas retirés au motif d'un interdit générique du skill. Les tokens du projet et les primitives React existantes servent de base ; aucun remplacement de bibliothèque ni ajout d'animation n'est automatique.

### Skills examinés et non retenus

- `brain-to-docs` : orienté entretien et README/ADR itératifs ; la demande présente porte sur un CDC à rédiger directement.
- `acceptance-orchestrator` : suppose une issue, des statuts et d'autres sous-skills ; ces prérequis ne sont pas établis.
- `agent-qa-authoring` : suppose un workspace et les outils Agent QA configurés ; pas de preuve de cette configuration dans le projet.
- `browser-testing-with-devtools` : suppose Chrome DevTools MCP configuré. Le plan utilise S07 et les outils réellement disponibles ; CDP ou Playwright peuvent fournir les preuves sans inventer de connecteur.
- `adapt`, `animate` : imposent des skills préparatoires non établis dans ce dossier. Les exigences responsive et de mouvement sont couvertes par S-UI, S06 et S07.

Ces exclusions n'impliquent pas que les outils seraient impossibles à utiliser. Elles évitent de rendre le plan dépendant d'une intégration non vérifiée.

## 4. Propriété des fichiers et parallélisation future

| Domaine | Propriétaire d'écriture | Limites |
| --- | --- | --- |
| Manifestes, lockfile, configuration de build/tests/CI | Worker outillage A07, ou A08 pendant l'adaptation de structure T010 | Un seul écrivain à la fois sur ces fichiers |
| Contrats audio, moteur, file et adaptation réactive | Worker audio A08 | Dépendants consommateurs attendent le contrat figé T015 |
| DB, migration, médias privés et upload admin | Worker données A08 | Ne change pas les composants audio ni le manifeste en parallèle |
| Catalogue, recherche et formulaires admin | Workers fonctions A07/A08 selon tâche | Consomme les contrats ; changements de types remontés au propriétaire |
| Tokens, structure et composants UI React | Worker UI A08, puis tâches A07 bornées | Identité Sheldon conservée ; composants de surface répartis sans chevauchement |
| Visualiseur et décor | Worker visualisation A08 | Contrat de l'analyseur consommé, sans modification du moteur |
| Preuves et scénarios de recette | QA A11 | Données synthétiques, profil isolé ; ne corrige pas silencieusement le code applicatif |
| API, Authentik et frontière proxy | Worker serveur A08 | Un propriétaire par middleware/contrat ; aucun secret dans React et aucune configuration externe sans autorisation |
| Favoris et isolation des comptes | A07 pour T055, A08 pour T071 | Contrat T068 figé ; tests croisés et cache vidés au changement d'identité |
| Intégration et documents finaux | A00 | Réconcilie contrats, décisions et livrables |

Les rôles peuvent travailler en parallèle après stabilisation de leurs contrats et lorsque leurs fichiers sont disjoints. Les opérations sur le lockfile, les migrations et les intégrations restent séquentielles. Un agent est informé que le workspace est partagé et qu'il ne doit jamais annuler les changements des autres.

## 5. Contrat de mission à utiliser lors de l'exécution

Chaque délégation précise :

1. Identifiant de tâche, objectif et exigences couvertes.
2. Agent réel choisi et skill résolu, avec le chemin à lire.
3. Décisions d'entrée validées et dépendances déjà disponibles.
4. Fichiers autorisés en écriture et fichiers explicitement possédés par d'autres.
5. Comportement attendu et cas négatifs à vérifier.
6. Livrables et preuves à retourner ; limite de fin observable.
7. Éléments qui requièrent de revenir au responsable : changement de périmètre, décision de produit, publication ou conflit de propriété impossible à résoudre.

Les tâches sont proposées, puis passent à « prête », « en cours », « en revue » et « acceptée ». Un simple retour de worker ne vaut pas acceptation. Une tâche en attente indique sa dépendance précise ; elle n'est pas déclarée terminée.

## 6. Revue et traçabilité

- Le créateur d'un changement ne signe pas seul sa recette indépendante.
- A09 examine les défauts et les tests ; A10 examine les tokens, composants et la fidélité à l'identité Sheldon retenue ; A11 observe le comportement ; A12 contrôle la cohérence de ces preuves.
- Les rapports sont rattachés au même état du code. Après une correction, les contrôles affectés sont rejoués et leur nouvelle référence est enregistrée.
- Avec Git disponible, utiliser le SHA complet. Sinon, A00 conserve un manifeste de fichiers et une empreinte de contenu. Aucun commit n'est créé sans demande explicite.
- Les rapports des agents en lecture seule sont intégrés aux documents par A00. Le rôle `plan` peut produire son artefact de plan dans son emplacement propre ; la version de référence pour ce projet est intégrée à `docs/cdc/`.
- La publication, la création d'une PR, l'envoi de messages et la modification de services externes nécessitent une autorisation correspondant à l'action. Ce CDC ne les déclenche pas.
