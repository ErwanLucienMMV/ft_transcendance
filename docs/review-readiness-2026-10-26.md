# Vérification finale des lots auth — 26 octobre 2026

## Verdict et périmètre

Révision applicative vérifiée : `4545500`, branche
`feat/lot-16-auth-profile-integration`. Base distante : `main=f055b79`,
`dev_test=0d7f30d` après fetch. Les deux bases ont le même contenu, avec
une différence de deux commits de fusion dans leur historique.

Les lots 10 à 16 sont prêts pour une review sur ces bases. Les simulations de
fusion vers main/dev_test et entre lots successifs sont propres. Cela ne signifie
pas que toutes les branches parallèles sont compatibles : les intégrations puzzle
et présence ont des blocages confirmés ci-dessous. Aucune PR créée, aucune fusion
vers main/dev_test, aucune modification des branches des collaborateurs.

La vérification porte sur notre diff, ses interfaces avec les branches distantes,
les tests et les builds. Ce n'est pas une certification de toute fonctionnalité
future ni du déploiement final. Les travaux non poussés des collègues sont invisibles.

## Confrontation à These.md

| Référence | Résultat |
| --- | --- |
| §3 : local, Google, GitHub, fournisseurs optionnels | Conforme : local préservé, les fournisseurs apparaissent uniquement quand configurés ; démarrage de production vérifié sans secrets OAuth. |
| §3.1 : inscription et token dans la réponse | Écart préexistant : l'inscription existante retourne le user sans token, puis demande la vérification d'e-mail. Aucun token anticipé ajouté. Faire confirmer et documenter ce contrat avec l'auteur de l'auth locale. |
| §3.2 : login via login/password, accessToken + user | Forme conservée pour une connexion complète ; challenge distinct si 2FA activée. |
| §3.3 : POST /auth/logout | Implémenté avec révocation serveur de la session courante. |
| §3.4 : routes Google/GitHub et identité interne User | Conforme ; ajout du handoff navigateur, de la liaison explicite et du retrait protégé. |
| §4 : GET /users/me | Projection SCRUM-95 d'Erwan préservée, une seule route, session révocable obligatoire. |
| §15 : AUTHENTICATE, AUTHENTICATED, userId | Conforme ; identité serveur, refus des challenges et invalidation après logout. |
| §38/40 : services séparés, identité interne, logique de jeu indépendante d'OAuth | Services et contrats métier préservés ; aucune dépendance du moteur à Google/GitHub. |
| §4, §5, §21–34 : édition de profil, amis, chat, matchmaking, présence, puzzles, etc. | Hors de ce lot ; ne pas présenter les 27 tickets auth comme la réalisation de toute la spécification. |

These.md est un document local non suivi par Git, lu sans modification.
Les routes publiques utilisent /api/v1 ; les contrôleurs Nest utilisent /v1.

## Validations réalisées

| Contrôle | Résultat |
| --- | --- |
| Backend : contrats TypeScript, unités, PostgreSQL, HTTP/WS | Nouvelle exécution complète réussie : 304 + 211 + 109 = 624 tests. |
| Adaptateur Nest vers bot/moteur réels | Réussi : difficultés, légalité, FEN, erreurs, positions terminales. |
| Bot C++ et transport réel | 112 contrôles réussis et suite WebSocket bot/moteur réussie. |
| Service mail | 8 tests réussis, 0 échec/skip. |
| Angular | 109 tests et build production réussis ; revalidés par la CI sur 4545500. |
| Navigateur Chromium | 12 tests réussis localement et en CI sur 4545500. |
| CI frontend | Run 40275617355 : success, tests/build Angular et Browser E2E. |
| Lint backend | 0 erreur, 28 avertissements. Aucun avertissement masqué ni règle désactivée. |
| Docker Compose production | config -q et construction de toutes les images réussies. |
| Démarrage production isolé | Tous les services démarrent ; PostgreSQL, mail et API healthy. Ports, noms, réseau et volumes dédiés au contrôle. |
| Nginx HTTPS | Frontend 200, providers 200 avec liste vide sans configuration OAuth, profil/logout 401 sans session. Certificat local auto-signé accepté explicitement par le client de test. |
| Nginx WSS | Upgrade réussi puis refus d'un token invalide : ERROR et fermeture 4401. |
| Google et GitHub réels | Connexions locales confirmées par l'utilisateur. |
| Helper OAuth | Syntaxe Bash, deux fournisseurs, permissions 0600, secrets non affichés, refus d'écrasement et d'entrée invalide validés sur des données factices. |
| Git | diff --check réussi, secrets non suivis, historique conservé. |

La CI générale backend/images ne se déclenche sur push que pour main/dev_test/
workflow et sur PR vers main/dev_test ; elle n'a donc pas exécuté tous ces jobs à
 distance sur nos branches de fonctionnalité. Les contrôles backend/images ont
été exécutés localement via Docker, sans changer les conditions CI.

Les avertissements npm/GitHub sur les versions d'actions et les scripts de
construction de dépendances n'ont pas empêché les builds. Leur maintenance reste
séparée ; aucune désactivation de test ou de contrôle n'a été ajoutée.

## Compatibilité avec les collaborateurs

### PR puzzle #58 — cursedastronaut

Branche examinée : `origin/feat/puzzle`, `c9e008b`.
La simulation contre notre tête produit trois conflits :

- src/auth/access-token.guard.ts (add/add) ;
- src/auth/auth.module.ts ;
- test/ticket-schema.integration-spec.ts.

Le guard puzzle refuse payload.typ, alors que nos sessions ont typ=access.
Il ne consulte pas la révocation serveur. Garder ce guard rendrait les nouveaux
logins incompatibles avec les puzzles. À l'intégration, réutiliser le guard de
session partagé, fournir le guard via les imports/exports Nest requis par
PuzzlesModule, et adapter les fixtures à des sessions réelles. Conserver les
assertions et les ajouts de schéma des deux côtés. Relancer les tests puzzle ET
sessions après cette résolution. La PR du collègue n'a pas été modifiée.

### Profil d'Erwan

SCRUM-95, commit 9582d0f, est intégré et préservé par le merge b8ac336 ;
4545500 raccorde son contrat au guard de session. Ses branches 96, 97, 98 et 99
se combinent sans conflit textuel lors de la simulation. Cela ne constitue pas
une validation d'exécution de leur fusion.

Les branches plus avancées (notamment 100–104) comportent des conflits sur les
modules App/Games/Users et les fixtures. Il faut conserver leurs endpoints de
profil public, recherche, pagination et préférences, en ajoutant SessionModule
et notre routage temps réel sans supprimer leurs providers.

### Présence d'Erwan — risque de comportement confirmé

Branche de référence : `origin/feat/s3-scrum-247-friends-presence`, `483cc0d`.
Outre les conflits de modules, guard, lockfile et fixtures :

- PresenceGateway et RealtimeGateway gèrent tous deux l'upgrade /ws sur le même
  serveur HTTP. Ne pas enregistrer deux propriétaires de cette même connexion.
- PresenceGateway importe verifyAccessToken depuis access-token.guard.ts ; cette
  API n'existe pas dans notre adaptateur. Conserver la version stateless du collègue
  pour compiler contournerait en outre les sessions révocables et rejetterait typ=access.
- Raccorder la présence au cycle authentification/déconnexion de notre transport,
  avec SessionService, en préservant multi-connexion, lastSeen et notifications amis.
- Ajouter les tests présence + logout + jeu sur une même connexion avant de valider
  l'intégration commune.

Cette adaptation n'a pas été exécutée : elle change une branche de travail
indépendante du collaborateur et dépasse le merge SCRUM-95 précédemment autorisé.

### ELO et branches historiques

Les branches ELO avancées touchent GamesModule et game-service.fixture.ts.
Préserver les hooks de fin de partie, l'idempotence et les providers de calcul.
Le relevé ci-dessous inclut aussi des anciennes branches remplacées/rejouées :
un conflit sur une ancienne référence ne signifie pas qu'elle doit être refusionnée.

## Ordre de review et d'intégration conseillé

1. Relire les lots 10 à 16 dans cet ordre (comparaison de chaque lot au précédent).
2. Pour que toute la CI prévue se déclenche, ouvrir plus tard les PR successivement
   vers dev_test, après intégration du lot précédent ; une PR entre deux branches
   feat/lot-* ne déclenche pas les workflows limités aux bases main/dev_test.
3. Contrôler la cible réelle et les nouvelles modifications des collègues juste
   avant chaque fusion ; ne jamais forcer ni réécrire leurs historiques.
4. Coordonner explicitement l'ordre puzzle, présence, profil/recherche et ELO.
5. Après résolution commune, exécuter toutes les suites des deux côtés ; notre CI
   verte isolée ne valide pas automatiquement cette future combinaison.

## Ce que Ta2b peut présenter pour cette semaine

- Socle Angular et écrans de connexion/inscription/vérification/2FA, validation
  des mots de passe et tests navigateur, transport WebSocket et synchronisation
  identité/événements, déjà intégrés via les lots précédents.
- Sessions JWT persistées et révocables, logout serveur/client, endpoint du compte
  courant, protection des mutations REST et des connexions WebSocket.
- Connexion Google/GitHub optionnelle de bout en bout, création et liaison explicite
  d'identités, retrait protégeant la dernière méthode de connexion, maintien de la 2FA.
- Régressions interservices, configuration locale privée et documentation de review.
- Intégration du profil d'Erwan en préservant son code et son historique.

L'inscription/login locale et ses règles de vérification e-mail/2FA existaient
côté backend : présenter notre travail comme leur intégration et leur extension,
pas comme une réécriture ou la création de tout le backend. Moteur, bot, profil,
présence, puzzles et ELO des collègues restent attribués à leurs auteurs.

## À annoncer à l'équipe

- Les tokens portent jti et typ=access ; les anciens tokens stateless sont refusés.
  Reconnexion nécessaire après mise à jour ; utiliser SessionService/guards partagés.
- Deux migrations additives créent auth_sessions et oauth_flows. Ne pas effacer les
  bases ni appliquer de rollback destructif pour mettre l'application à jour.
- Un seul GET /users/me et un seul propriétaire du transport /ws.
- Logout révoque une session ; les sockets ouvertes la revalident environ chaque
  seconde. Un autre appareil connecté reste utilisable.
- Tokens applicatifs uniquement en mémoire ; un rechargement demande une connexion.
- Les secrets OAuth ne sont pas dans Git. Chacun configure son environnement ;
  l'activation et le test sur le domaine final HTTPS restent pour la fin du projet.
- Pas de PR ouverte par l'agent ; branches publiées, tickets In Review.

## Prochains tickets conseillés

Vérifiés dans Jira le 26/10 : tous les tickets ci-dessous sont To Do et non assignés.

1. SCRUM-335 : page profil, en commençant par GET /users/me disponible sur notre lot.
2. SCRUM-336 : affichage ELO, avec les données serveur du profil.
3. SCRUM-342 : recherche utilisateur, après accord/intégration des endpoints d'Erwan
   (102–104), sans réimplémenter leur logique backend.
4. Ensuite SCRUM-337 (amis) et SCRUM-343 (online/offline), après raccordement commun
   de la présence et confirmation des API amis.

Aucun de ces tickets n'a été réassigné ni démarré par cette vérification.
Propositions à discuter : ticket de convergence auth/puzzle, ticket de convergence
présence/temps réel et clarification du contrat d'inscription de These.md. Ces
points sont à coordonner avant les fusions concernées, plutôt que multiplier de
nouvelles fonctionnalités auth.

## Vérifications volontairement finales / limites restantes

- Identifiants du serveur et consentements sur le domaine final HTTPS ; tests réels
  de liaison/retrait/annulation/2FA chez les fournisseurs (ces parcours sont testés
  automatiquement, seuls les deux logins réels ont été confirmés manuellement).
- Charge et comportement multi-instance de la révocation/presence ; pas de test de
  charge ou de bascule de production dans cette passe.
- Actualisation des bases après de nouveaux pushes des collègues.
- Le résultat ne garantit pas l'absence absolue de bug ; aucun échec de test n'est
  masqué et les incompatibilités confirmées restent explicitement visibles.

## Inventaire des simulations de fusion de références non ancêtres

49 références non ancêtres ont été simulées avec git merge-tree --write-tree :
17 propres, 32 en conflit. Aucun checkout, merge effectif ou changement de branche.

| Référence distante | Simulation textuelle |
| --- | --- |
| `origin/ErwanLucienMMV-patch-1` | Conflits |
| `origin/feat/angular-app` | Conflits |
| `origin/feat/chess-engine` | Propre |
| `origin/feat/elo-calculation` | Propre |
| `origin/feat/elo-game-lifecycle` | Conflits |
| `origin/feat/elo-history-api` | Propre |
| `origin/feat/elo-persistence` | Propre |
| `origin/feat/game-clock` | Conflits |
| `origin/feat/game-database-foundation` | Conflits |
| `origin/feat/game-rest-api` | Conflits |
| `origin/feat/puzzle` | Conflits |
| `origin/feat/s3-scrum-100-public-profile` | Conflits |
| `origin/feat/s3-scrum-101-profile-privacy` | Conflits |
| `origin/feat/s3-scrum-102-search-endpoint` | Conflits |
| `origin/feat/s3-scrum-103-username-search` | Conflits |
| `origin/feat/s3-scrum-104-search-pagination` | Conflits |
| `origin/feat/s3-scrum-205-initial-rating` | Propre |
| `origin/feat/s3-scrum-206-expected-score` | Propre |
| `origin/feat/s3-scrum-207-rating-delta` | Propre |
| `origin/feat/s3-scrum-208-victory` | Propre |
| `origin/feat/s3-scrum-209-defeat` | Propre |
| `origin/feat/s3-scrum-210-draw` | Propre |
| `origin/feat/s3-scrum-211-game-rating` | Conflits |
| `origin/feat/s3-scrum-212-rating-history` | Propre |
| `origin/feat/s3-scrum-213-history-api` | Conflits |
| `origin/feat/s3-scrum-214-idempotent-rating` | Propre |
| `origin/feat/s3-scrum-215-calculation-tests` | Propre |
| `origin/feat/s3-scrum-238-presence-service` | Conflits |
| `origin/feat/s3-scrum-239-connect` | Conflits |
| `origin/feat/s3-scrum-240-disconnect` | Conflits |
| `origin/feat/s3-scrum-241-online` | Conflits |
| `origin/feat/s3-scrum-242-in-game` | Conflits |
| `origin/feat/s3-scrum-243-offline` | Conflits |
| `origin/feat/s3-scrum-244-last-seen` | Conflits |
| `origin/feat/s3-scrum-245-online-events` | Conflits |
| `origin/feat/s3-scrum-246-offline-events` | Conflits |
| `origin/feat/s3-scrum-247-friends-presence` | Conflits |
| `origin/feat/s3-scrum-449-elo-tests` | Conflits |
| `origin/feat/s3-scrum-481-rating-e2e` | Conflits |
| `origin/feat/s3-scrum-515-elo-docs` | Conflits |
| `origin/feat/s3-scrum-96-profile-update` | Propre |
| `origin/feat/s3-scrum-97-username` | Propre |
| `origin/feat/s3-scrum-98-avatar` | Propre |
| `origin/feat/s3-scrum-99-preferences` | Propre |
| `origin/replay/backend-database-foundation` | Conflits |
| `origin/replay/chess-engine` | Conflits |
| `origin/replay/game-clock` | Conflits |
| `origin/replay/game-database-foundation` | Conflits |
| `origin/replay/game-lifecycle` | Conflits |
