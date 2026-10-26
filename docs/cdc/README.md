# Cahier des charges — Sheldon Player

Version : 1.2 — 23 octobre 2026. Statut : périmètre fonctionnel confirmé ; infrastructure à préciser avant réalisation.

## Résultat attendu

Moderniser le projet personnel en React pour en faire un lecteur privé derrière Authentik. Le catalogue est partagé et alimenté depuis un dashboard réservé aux administrateurs. Les membres du groupe users écoutent et gèrent leurs favoris personnels ; le groupe admin dispose en plus de la gestion du catalogue.

## Décisions confirmées

- React conservé ; aucune migration Svelte ni intégration Muse.
- Identité Sheldon à dominante violette conservée, avec shaders et un seul thème.
- Programme complet réalisé par étapes.
- Accès réservé aux groupes Authentik users et admin ; admin donne aussi accès au lecteur.
- Ajout des sons uniquement depuis le dashboard admin, en FLAC, MP3 et WAV.
- Favoris propres à chaque utilisateur, persistés côté serveur.
- Aucune playlist privée ni ajout de morceau depuis le lecteur.
- Suppression du sélecteur de thème, des titres visibles « Sheldon Player » / « Click to Play » et de leurs variantes sans espaces.
- Suppression du bouton Menu et de tout son contenu ; éventuel repositionnement traité ultérieurement.
- Bouton de plein écran pour le visualiseur, sans interruption de lecture.
- Scrollbar de la liste masquée visuellement ; défilement conservé.

## Documents

| Document | Contenu |
| --- | --- |
| [01 — Contexte et périmètre](01-contexte-et-perimetre.md) | État initial, évolution du besoin et limites |
| [02 — Exigences](02-exigences.md) | Fonctionnement attendu et critères de qualité |
| [03 — Architecture et décisions](03-architecture-et-decisions.md) | Frontend, API, stockage central et décisions |
| [04 — Backlog](04-backlog.md) | Tâches, dépendances, agents, skills et preuves |
| [05 — Agents et skills](05-agents-et-skills.md) | Rôles réels et méthodes attribuées |
| [06 — Recette et livraison](06-recette-et-livraison.md) | Scénarios et jalons |
| [07 — Administration et Authentik](07-admin-authentik-et-ajustements.md) | Droits, parcours admin et ajustements UI |

Les nouvelles décisions remplacent les propositions initiales de bibliothèque locale utilisateur, playlists privées, thèmes multiples et fonctionnement sans serveur. Les identifiants de tâches sont conservés ; leurs descriptions sont révisées.

## Réalisation

1. Finaliser infrastructure, Authentik, base et stockage privé.
2. Moderniser les outils et fiabiliser le moteur audio.
3. Construire API, autorisations et catalogue central.
4. Réaliser dashboard, favoris et ajustements du lecteur.
5. Exécuter tests, revue, recette réelle et préparation de livraison.

Le backlog compte 76 tâches : 69 principales et 7 options non sélectionnées. T055, favoris par utilisateur, appartient désormais au principal.

## Points encore ouverts

Reverse proxy et mode d'intégration Authentik ; hébergement et origine ; correspondance technique des groupes ; quotas d'upload ; outils/runtime ; navigateurs/appareils et éventuelles options. Les groupes fonctionnels users/admin sont confirmés, leurs mappings doivent être vérifiés sur l'instance.

La phase actuelle porte sur le CDC. Elle ne déclenche ni développement applicatif, ni modification d'Authentik, ni publication.

## Conventions

Fxx : exigence ; Nxx : qualité ; Rxx : recette ; Txxx : tâche ; Axx : agent ; Sxx : skill. P0 : indispensable ; P1 : programme principal ; P2 : option.

Un livrable est accepté lorsque ses exigences ont des preuves sur la version livrée, sans anomalie bloquante ni perte de données. Un scénario prévu n'est pas un scénario déjà exécuté.
