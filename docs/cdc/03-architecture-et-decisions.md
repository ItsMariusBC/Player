# 03 — Architecture et décisions

## 1. Architecture fonctionnelle

La demande de dashboard admin, d'Authentik et de favoris individuels remplace l'application uniquement statique proposée initialement. React reste le frontend. Un serveur contrôle identité, droits, catalogue, favoris et médias.

- Navigateur : lecteur et dashboard React.
- Entrée HTTPS / reverse proxy : adaptée à l'installation existante.
- Authentik : authentification et appartenance aux groupes.
- API : autorisation, catalogue, upload admin et favoris du compte courant.
- Base centrale : utilisateurs techniques, catalogue, favoris et états de traitement.
- Stockage privé : originaux audio, pochettes et éventuelles variantes de lecture.

Le framework API, la base exacte et le stockage ne sont pas encore choisis. Une API TypeScript et une base SQL sont proposés ; PostgreSQL et volume privé ou stockage objet privé seront comparés à l'infrastructure réelle. Aucun fournisseur ni service payant n'est activé ici.

## 2. Responsabilités

| Module | Responsabilité |
| --- | --- |
| Moteur TypeScript | Élément audio, graphe facultatif, commandes, progression, attente et erreurs |
| File | Occurrences ordonnées, sélection, navigation, mélange et fin |
| Adaptation React | Abonnements désinscriptibles, état commun aux vues |
| Catalogue serveur | Identifiants stables, métadonnées, statut et ressources privées |
| Identité et accès | Identité de confiance, groupes, permissions et expiration |
| Favoris | Relation utilisateur/morceau ; accès limité au propriétaire |
| Administration | Upload, validation, édition, publication et retrait contrôlé |
| Médias | Flux autorisé, requêtes Range et pochettes protégées |
| Préférences locales | Volume et préférences non sensibles ; aucun rôle ni favori de référence dans localStorage |
| Présentation | Thème unique, shaders, commandes directes et visualiseur plein écran |

Les fichiers actuels sont adaptés progressivement. Contrats et propriétaires des modules serveur sont définis avant implémentation. Les callbacks écrasés deviennent des abonnements retournant un désabonnement ; démonter une vue n'affecte pas les autres.

## 3. Moteur et lecture

Un élément audio actif par instance ; initialisation/reprise du contexte dans une interaction utilisateur valide ; analyseur absent possible avant activation, sans contexte temporaire supplémentaire. Le média confirme l'état de lecture.

Les commandes asynchrones exposent erreurs et annulation. Une demande de piste plus récente empêche une attente ancienne de relancer l'ancien morceau. Temps et volume sont bornés ; durée inconnue explicite. La destruction annule attentes, écouteurs, boucles et ressources appartenant à l'instance.

La navigation utilise la file active, y compris vide ou à un titre. Le mélange conserve le morceau courant. Une erreur garde la file et offre un choix de reprise, sans tentatives infinies. Voir les [bonnes pratiques Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).

## 4. Intégration Authentik à choisir selon l'installation

Deux voies documentées sont à comparer :

- OIDC serveur : Authorization Code avec PKCE, state/nonce et validation issuer/audience/signature/expiration via bibliothèque maintenue. Session par cookie adapté à HTTPS ; secrets/tokens côté serveur. Voir le [provider OAuth2/OIDC](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/).
- Proxy / forward auth : proxy/outpost vérifient l'identité ; l'application ne fait confiance qu'à cette frontière. Headers entrants supprimés/remplacés et backend non joignable directement. Voir le [provider proxy](https://docs.goauthentik.io/add-secure-apps/providers/proxy/) et le [forward auth](https://docs.goauthentik.io/add-secure-apps/providers/proxy/forward_auth/).

Une seule voie de confiance est sélectionnée et testée, sans empiler les deux sans besoin. Version Authentik, reverse proxy et mode existants restent à préciser. Les modifications réelles de l'instance ne sont pas autorisées par ce CDC.

## 5. Identité, autorisation et session

Identité stable fournie par la source vérifiée : issuer + subject en OIDC, ou identifiant stable du provider proxy vérifié. Nom affiché et email ne servent pas seuls de clé.

users et admin sont les deux groupes autorisés. admin inclut écoute/favoris ; il n'est pas nécessaire d'exiger aussi users. Sans groupe reconnu : refus, même après connexion. Noms exacts, casse et mappings seront vérifiés.

Le serveur calcule le propriétaire des favoris depuis la session. Aucun champ userId client ne permet de choisir un autre propriétaire. Les admins n'ont pas de droit supplémentaire sur les favoris d'autrui.

Durée de session, réévaluation des groupes et révocation sont spécifiées avant implémentation. Déconnexion/expiration connue : arrêter le média et vider l'état personnel. Les octets déjà transmis au navigateur ne peuvent pas être retirés rétroactivement.

## 6. Données centrales

| Entité | Champs conceptuels et invariants |
| --- | --- |
| Utilisateur technique | ID interne, provider, subject stable, nom affiché facultatif ; aucun mot de passe local |
| Morceau | ID stable, titre, artiste, format, durée facultative, statut, média |
| Média | Clé interne, original, taille, empreinte, type validé et statut ; pas de chemin choisi par le navigateur |
| Pochette | Référence privée, contenu validé |
| Favori | userId + trackId uniques ; ajout/retrait idempotents |
| Import | Auteur admin, état, erreurs par fichier et ressources temporaires privées |
| Événement admin | Acteur, action, morceau et résultat ; aucun secret/token |
| Reprise locale | File/position bornées et limitées au compte ; vidées au changement de compte |

Aucune playlist privée dans le modèle cible. Les favoris sont stockés côté serveur et retrouvés depuis un autre navigateur. Le stockage local ne constitue pas une preuve de droits.

## 7. Upload et médias

Formats confirmés : FLAC, MP3, WAV ; « WAW » est interprété comme WAV. Le support couvre import et lecture sur les navigateurs cibles, pas seulement une extension acceptée.

L'upload admin passe par une zone temporaire privée, validation réelle du contenu/tags et publication cohérente. Un échec ne laisse ni fichier public ni entrée jouable partielle. Bilan par fichier et doublons de contenu signalés.

Limites nombre/taille, quotas et éventuelle conversion à confirmer : les anciennes propositions 50 fichiers/100 Mio ne sont pas validées. Un format non décodé par un navigateur cible nécessite un arbitrage documenté sur une variante de lecture avant d'être déclaré conforme.

Migrer les MP3 actuels de public vers le stockage privé ; tester les anciennes URL sans session. Audio et pochettes ne sont jamais exposés par bucket public ou URL permanente contournant Authentik.

GET, HEAD et Range vérifient l'accès. Réponses partielles 206, tailles/plages et erreurs appropriées sont testées. Les politiques de cache empêchent le partage d'informations personnelles entre sessions.

## 8. Migration et récupération

- Importer les 10 titres actuels avec IDs stables et rapport idempotent.
- Sauvegarder les métadonnées avant conversion.
- Aucun transfert automatique de custom_songs/playlists depuis un navigateur vers un compte arbitraire.
- Retirer les anciennes UI n'autorise pas l'effacement des données historiques.
- Les anciennes préférences de thème sont ignorées sans effacement destructif automatique.
- Sauvegarder et restaurer ensemble base, médias et références cohérentes.
- IndexedDB n'est plus le stockage central ; le hors ligne est une option non sélectionnée.

## 9. Direction graphique confirmée

Un thème Sheldon à dominante violette et shaders. Aucun mode clair/sombre/système ni choix de palette. Réduction des animations et rendu statique si WebGL indisponible conservent l'accès au lecteur.

Pas de titres visibles Sheldon Player/Click to Play ou variantes sans espaces ; métadonnées du document conservables. Pas de bouton Menu ni de ses contenus ; leur repositionnement n'est pas inclus.

Visualiseur plein écran/retour ; scrollbar de la liste masquée sans empêcher le défilement. Voir les [critères détaillés](07-admin-authentik-et-ajustements.md).

## 10. Décisions

| ID | Statut |
| --- | --- |
| D01 | Validée : projet personnel React ; Muse/Svelte exclus |
| D02 | Validée : identité violette avec shaders et thème unique ; détails du brief à préciser |
| D03 | Validée puis révisée : programme complet par étapes, serveur/admin/Authentik ; sans bibliothèque locale utilisateur ni playlists privées |
| D04 | FLAC/MP3/WAV et upload admin validés ; quotas et conversion éventuelle ouverts |
| D05 | Runtime/outils/tests à figer ; un seul lockfile |
| D06 | Service central requis ; domaine, machine et stockage à préciser |
| D07 | Navigateurs/appareils et budgets incluant streaming/upload à valider |
| D08 | Favoris individuels retenus ; autres options non sélectionnées |
| D09 | Authentik et groupes users/admin confirmés ; mode, mappings, sessions/proxy à préciser |
| D10 | Users : écoute et favoris seulement, sans ajout ni playlists privées |
| D11 | Thème unique, pas de titres/Menu, visualiseur plein écran et scrollbar masquée confirmés |

## 11. Modernisation et livraison

T003 établit versions exactes, runtime, peer dependencies et usages. Changements React/Vite/Tailwind/shaders/API testés par paliers et verrouillés. Consulter les guides [React](https://react.dev/blog/2024/04/25/react-19-upgrade-guide), [Vite](https://vite.dev/guide/migration) et [Tailwind](https://tailwindcss.com/docs/upgrade-guide) selon les versions retenues.

Les mesures séparent JS/CSS, authentification, API, audio et coût shader. Aucun catalogue complet préchargé. La publication et les changements externes sont des opérations distinctes à autoriser sur une configuration concrète.
