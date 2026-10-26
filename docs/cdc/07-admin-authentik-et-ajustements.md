# 07 — Administration, Authentik et ajustements confirmés

Version 1.2. Ce chapitre consigne les réponses utilisateur et les critères détaillés.

## 1. Matrice des droits

| Action | Non connecté | Sans groupe reconnu | users | admin |
| --- | --- | --- | --- | --- |
| Lecteur et catalogue | Authentik requis | Refus | Oui | Oui |
| Audio/pochette par URL directe | Refus | Refus | Oui | Oui |
| Ses propres favoris | Refus | Refus | Oui | Oui |
| Favoris d'un autre compte | Refus | Refus | Refus | Refus |
| Dashboard admin | Refus | Refus | Refus | Oui |
| Import FLAC/MP3/WAV | Refus | Refus | Refus | Oui |
| Édition/publication/retrait de morceau | Refus | Refus | Refus | Oui |
| Ajout depuis le lecteur/Menu | Absent | Absent | Absent | Absent |
| Playlists privées | Absent | Absent | Absent | Absent |
| Administration des comptes Authentik depuis le site | Absent | Absent | Absent | Absent |

Édition, publication et retrait constituent la proposition de gestion complète du catalogue dans le dashboard. Les suppressions nécessitent une confirmation et des règles de cohérence ; aucun média n'est supprimé pendant le cadrage.

## 2. Parcours

L'utilisateur passe par Authentik, puis le serveur contrôle users/admin. Il voit catalogue commun et favoris personnels ; il écoute, cherche et navigue dans la file. Aucun formulaire d'ajout ni playlist privée.

Le favori appartient au compte, pas au navigateur. Une déconnexion puis connexion d'un autre compte ne montre aucune donnée précédente. Les opérations concurrentes sont cohérentes et idempotentes.

L'admin rejoint un écran dédié, par exemple /admin, dont chaque API vérifie le rôle. Il importe, suit le bilan par fichier, corrige les tags/pochettes et publie dans le catalogue partagé. Un éventuel lien d'accès ne réintroduit pas le Menu supprimé.

Les imports échoués n'effacent pas les succès. Le retrait d'un titre empêche les nouvelles lectures et traite les favoris associés ; il ne promet pas de retirer les octets déjà chargés.

## 3. Contrats HTTP à livrer en T068

| Surface | Règle |
| --- | --- |
| Session/compte courant | Identité et permissions serveur, expiration et logout, aucun secret |
| Catalogue | Liste/recherche paginée et détail après autorisation |
| Médias/pochettes | Lecture authentifiée ; HEAD/Range audio, cache contrôlé |
| Favoris du compte courant | Liste, ajout/retrait idempotents ; aucun choix de propriétaire client |
| Administration | Import, état, édition, publication, retrait ; contrôle admin sur chaque opération |

URL/schémas exacts, erreurs JSON, statuts, limites et pagination sont définis avant implémentation. Les types TypeScript ne remplacent pas la validation des requêtes reçues.

## 4. Ajustements UI

### Thème unique

Retirer bouton clair/sombre/système et toute sélection/création de thème. Palette unique cohérente avec les shaders. La préférence de réduction des mouvements reste respectée, sans constituer un choix de thème.

### Textes retirés

Retirer les titres visibles « Sheldon Player », « SheldonPlayer », « Click to Play », « ClicktoPlay » et leur animation de lettres. Aucun espace vide réservé à cet ancien titre. Préserver les labels utiles et la sémantique des commandes ; le titre de l'onglet peut conserver le nom du site.

### Menu retiré

Supprimer bouton Menu, popover et contenus Controls/Settings, Playlists, Identifier, Custom Songs, GitHub, Theme, Visualizer Settings et About. Aucun déplacement de ces contenus dans ce lot. Les commandes fondamentales restent directement près du morceau ; les réglages fins du visualiseur restent internes jusqu'à un nouveau cadrage.

### Visualiseur plein écran

Bouton d'agrandissement nommé et accessible. Plein écran natif du conteneur si supporté ; redimensionnement Canvas/DPR ; bouton retour. Échap et sortie native mettent à jour l'état. Si refus/absence de support, vue agrandie dans la page, distinguée du plein écran natif. Focus géré et lecture/position conservées.

Les [événements et erreurs Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API) sont pris en compte.

### Scrollbar masquée

Masquer la barre avec les mécanismes CSS des navigateurs cibles. Conserver molette, trackpad, tactile et clavier ; ne pas bloquer le défilement par overflow hidden. Le morceau focalisé reste ramené dans la partie visible.

## 5. Exigences complémentaires

| ID | Critère | Tâches | Recette |
| --- | --- | --- | --- |
| F27 | Authentik requis ; users ou admin ; sans groupe reconnu refusé | T065, T066, T069 | R38, R39 |
| F28 | Contrôle admin serveur ; aucun contournement UI/header/appel direct | T066, T070, T075 | R39, R44 |
| F29 | Dashboard et import FLAC/MP3/WAV, édition/publication | T029–T031, T038 | R40, R45 |
| F30 | Médias privés, anciennes URL et Range contrôlés | T032, T067 | R41 |
| F31 | Agrandissement/retour visualiseur sans relance du média | T076 | R47 |
| F32 | Titres/Menu/contenus retirés sans déplacement implicite | T028, T043 | R49 |
| F33 | Scrollbar invisible et défilement/clavier conservés | T037 | R48 |
| N11 | Isolation, expiration/révocation et état personnel nettoyé | T055, T069–T071 | R42–R44 |
| N12 | Sauvegarde base/médias et restauration réelle | T073 | R46 |

Les questions d'infrastructure ne rouvrent pas ces choix fonctionnels. Aucun secret n'est nécessaire au cadrage.
