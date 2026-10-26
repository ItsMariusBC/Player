# Suivi de réalisation

## Retour arrière demandé

La réalisation a été arrêtée à la demande de l'utilisateur. La refonte de disposition, des fenêtres et de leurs styles était hors du changement attendu. Les sources d'avant l'implémentation ont été récupérées dans l'historique puis restaurées, ainsi que l'ancien outillage et ses versions installées. Les ajouts de cette tentative sont archivés hors du projet : /Users/marius.b/.codex/tmp/sheldon-annule-1792741422505. Le service API et le conteneur PostgreSQL de cette tentative ont été arrêtés ; les données ne sont pas détruites.

Pour toute reprise : conserver strictement la disposition existante, les styles des fenêtres, leurs transparences et backdrop-filter. Appliquer uniquement les changements fonctionnels explicitement demandés, sans nouvelle refonte graphique.

Les affectations et résultats ci-dessous concernent la tentative annulée ; ils ne constituent pas des fonctionnalités actuellement livrées.

Début : 23 octobre 2026. L'utilisateur autorise le développement et la répartition entre agents. La publication et la modification de l'instance Authentik restent distinctes.

## Décisions et entrées

React, identité violette/shaders, thème unique, utilisateurs users/admin, catalogue central, import admin FLAC/MP3/WAV et favoris privés sont confirmés.

L'hébergement et le reverse proxy/Auth existants ont été demandés à l'utilisateur. Ils n'empêchent pas de développer les contrats, le moteur, l'interface et le backend configurable. La recette Authentik réelle dépendra d'une configuration et de comptes de test autorisés.

## Travaux en cours

| Travail | Agent | Propriété |
| --- | --- | --- |
| Inventaire et référence de départ | explorer — baseline | Lecture seule |
| Versions et compatibilités | librarian — dependency_research | Lecture seule |
| Contrats, outillage et intégration | Agent principal | shared/, manifestes, configuration, documentation et tests d'intégration |

Les affectations d'implémentation et les preuves sont ajoutées à mesure de leur lancement. Aucun livrable n'est déclaré terminé par la seule affectation d'un agent.
