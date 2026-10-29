# Matchmaking : API, événements et validation indépendante

Tickets QA : SCRUM-450 / TEST-09, SCRUM-470 / E2E-05 et SCRUM-516 / DOC-09.
L'inventaire Jira et la source CSV autorisée sont dans
[sprint4-source-and-ownership.md](sprint4-source-and-ownership.md).

## Préconditions et unités

Un compte vérifié et une session bearer valide, non expirée et non révoquée sont
requis. L'identité vient de la session, jamais du corps de requête. Le contrôle
est `{ initialTime, increment }`, en millisecondes entières, avec initialTime > 0
et increment >= 0. Le serveur lit l'Elo du compte ; le client ne le choisit pas.

La politique Elo symétrique et son élargissement avec l'attente sont détaillés
dans [matchmaking-policy.md](matchmaking-policy.md). Les deux joueurs doivent
accepter l'écart Elo et utiliser exactement le même contrôle de temps.

## Routes

| Méthode | Route | Réponse |
|---|---|---|
| POST | `/v1/matchmaking/join` | 201 `{ status: "WAITING", joinedAt: ISO8601 }` après persistance de l'entrée |
| GET | `/v1/matchmaking/status` | 200 avec status `IDLE`, `WAITING`, `CANCELLED` ou `MATCHED` ; joinedAt pour attente/annulation et gameId si la partie affectée existe |
| POST | `/v1/matchmaking/leave` | 200 avec l'état durable ; une entrée WAITING devient CANCELLED |

L'appariement est asynchrone. Le worker cherche une fois par seconde et traite
au plus 20 parties par passage. Le résultat de join confirme l'inscription,
pas l'absence d'un match intervenu entre sa transaction et la lecture HTTP.

Un utilisateur conserve une seule ligne de queue. Un nouveau join après une
annulation ou une partie terminée réutilise cette ligne avec un nouvel âge FIFO,
un Elo actualisé et sans ancien gameId. Un join pendant WAITING ou une partie
active renvoie 409 (`ALREADY_IN_QUEUE` ou `ACTIVE_GAME_EXISTS`). Les jetons absents,
invalides ou révoqués renvoient 401 ; les contrôles ou champs supplémentaires
invalides renvoient 400. Une erreur interne de transaction ne doit pas laisser
de partie, de siège ou de queue partiellement modifiés.

Leave est ordonné avec les autres mutations par un verrou transactionnel
PostgreSQL. Si l'annulation commit en premier, cette entrée ne peut plus être
sélectionnée. Si le matching a déjà commit, leave retourne MATCHED et conserve
la partie : quitter la queue n'est pas abandonner une partie déjà créée.

## WebSocket et récupération

Ouvrir `/ws`, puis envoyer :

```json
{"event":"AUTHENTICATE","data":{"accessToken":"<session bearer>"}}
```

Attendre AUTHENTICATED. Le serveur émet ensuite, uniquement pour les deux joueurs
autorisés et sur leurs sockets encore valides :

```json
{"event":"MATCH_FOUND","data":{"gameId":"<uuid>","color":"WHITE","opponentId":"<uuid>"}}
```

L'autre joueur reçoit BLACK et l'identifiant opposé. Aucun socket tiers ne reçoit
cet événement. La session est revérifiée avant chaque livraison. Les commandes
de partie existantes, notamment JOIN_GAME, utilisent ensuite gameId.

PostgreSQL publie la notification à la validation de la transaction ; le bridge
de chaque réplique vérifie la partie ACTIVE et ses deux sièges avant livraison.
La création de partie, ses horloges et sièges, les deux statuts MATCHED, la
référence matchedGameId et le journal des durées d'attente sont atomiques.

Une déconnexion réseau ne vaut pas une annulation explicite de queue. Si un
événement est manqué pendant une déconnexion, une session expirée ou une panne
du listener, consulter GET status après reconnexion pour retrouver exactement
la partie affectée. Le transport LISTEN/NOTIFY n'est pas une file de messages
avec acquittement ou replay ; ne pas attendre une livraison exactement une fois.
Le journal matchmaking_matches est la source des durées réelles en secondes,
pas une estimation à partir de l'âge courant d'une ligne réutilisable.

## Scénarios indépendants

Le fichier `test/matchmaking-workflow.e2e-spec.ts` démarre le vrai AppModule, les
vraies sessions, un serveur HTTP/WS et PostgreSQL. Aucun bypass d'authentification
n'est ajouté à la production. Les scénarios couvrent :

1. Rejet d'un anonyme et d'un acteur injecté dans le corps, sans écriture queue.
2. Deux joueurs notifiés avec la même partie déjà commit, deux couleurs distinctes,
   aucun événement pour un tiers, aucun match doublé lors d'un passage suivant.
3. Six arrivées simultanées : trois parties et six utilisateurs uniques.
4. Annulation effective puis arrivées compatibles : l'utilisateur annulé reste exclu.
5. Déconnexion avant matching puis récupération HTTP de la partie après reconnexion.
6. Révocation de session entre inscription et matching : événement privé bloqué,
   ancien bearer refusé, récupération possible avec une nouvelle session.
7. Erreur injectée dans la création de partie : rollback sans notification, puis
   nouvelle exécution du vrai worker et création unique à partir des mêmes entrées.

Les tests PostgreSQL du worker Matchmaking complètent cette couverture avec le
verrouillage concurrent inter-transactions, la sélection FIFO, les critères Elo,
la concurrence annulation/sélection et les échecs à l'intérieur de la transaction.
Une défaillance de production révélée en QA est retournée à ce worker pour
correction dans sa branche ; la branche QA ne duplique pas l'implémentation.

## Commandes

Depuis `srcs/nestJS/42chess`, avec les fixtures PostgreSQL/chess/bot du dépôt :

```sh
npm run build
npm run test:contracts
npx vitest run --config vitest.config.e2e.ts test/matchmaking-workflow.e2e-spec.ts
npm run test:db
npm run test:e2e
npm run lint
```

La validation de cette branche utilise une base jetable séparée
`sprint4-qa-postgres` et les moteurs de test existants sur le réseau Docker de
tests. Elle ne lit aucun fichier .env privé et ne réutilise pas la base du worker
Matchmaking pendant ses propres validations.

Cette branche dépend explicitement de la fondation PR #64 et du commit validé
de `feat/matchmaking`. Les merges de dépendances conservent les deux historiques.
Aucune fusion automatique vers dev_test ou main n'est autorisée.

## Résultats QA du 29 octobre 2026

Dépendance testée : `7fc2f14a1114470c6fb0a3e37ca3f2941ee6350b`, publiée sur
`feat/matchmaking` et proposée par la PR #68 ; fondation PR #64. Le merge de
dépendance QA est `a6ceddd`. Résultats Docker sur la base QA isolée :

| Vérification | Résultat |
|---|---|
| Build backend et contrats TypeScript | PASS |
| Sept scénarios HTTP/WS/PostgreSQL indépendants | 7/7 PASS, 18,73 s pour le lancement complet |
| Revalidation après décodage WebSocket typé | 7/7 PASS, 13,84 s pour le lancement complet |
| Lint du nouveau fichier de tests | 0 avertissement, 0 erreur |
| Lint backend avant correction du seul avertissement QA | 0 erreur ; 28 avertissements existants et 1 QA corrigé |
| `git diff --check` et revue des ajouts | PASS |

Les 1 100 tests du parent Matchmaking ont été validés séparément par son worker
(483 unités, 335 PostgreSQL, 282 E2E). Ces sept scénarios s'y ajoutent ; les
revalidations ne sont pas comptées comme de nouveaux tests. Aucun workflow ni
test existant n'a été désactivé. La QA n'a pas nécessité de changement de
l'implémentation après réception du commit validé.

Limites : le verrou advisory sérialise le matching ; son débit n'a pas été
benchmarké. La protection contre le double matching ne change pas le contrat des
API manuelles, qui autorisent historiquement plusieurs parties actives. Les
notifications manquées nécessitent la récupération par status décrite plus haut.
