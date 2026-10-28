# Sprint 4: source Jira et responsabilités

L'utilisateur a désigné `C:/Users/erwan/Downloads/Jira.csv` comme source de vérité
Jira le 28 octobre 2026. Empreinte SHA-256 du fichier consulté :
`C96FA255394A9323B8BB2AEA977E5F353AEBC4E6BC0EB6F395575548224770DE`.
Les 42 clés sont distinctes : 5 Done, 10 In Review, 3 In Progress, 24 To Do.
Une ligne sans clé n'est pas un ticket. L'export ne comporte pas de colonne
sprint : le périmètre Sprint 4 provient de la mission utilisateur.

## Inventaire Jira

| Périmètre | In Review | In Progress | To Do | Done à préserver |
|---|---|---|---|---|
| Matchmaking | SCRUM-216,219,220 | SCRUM-221 | SCRUM-217,218,222–227 | — |
| Friends | SCRUM-228,229,233 | SCRUM-234 | SCRUM-230–232,235–237,446 | — |
| Observabilité | SCRUM-425–427,438 | SCRUM-428 | SCRUM-429–431,440 | — |
| Daily Puzzle | — | — | SCRUM-307 | — |
| Clock | — | — | SCRUM-174 | — |
| QA/documentation matchmaking | — | — | SCRUM-450,470,516 | — |
| Présence | — | — | — | SCRUM-238,239,244,245,247 |

Les statuts Jira décrivent le suivi des tickets. Ils ne prouvent pas l'absence
de code. L'endpoint daily est déjà intégré ; les garde-fous self/duplicate Friends,
le join/policy/candidate matchmaking et plusieurs métriques sont déjà présents.

## Bases et dépendances explicites

- Cible de PR : `dev_test`, référence distante vérifiée :
  `db4787ed3adc1ee470a09801b9a0c3981d36d114`.
- Prérequis commun Friends/Matchmaking/Observabilité/QA :
  `12448f04e177d72d92097e670738cb73007e9841`, branche
  `feat/sprint4-foundation-preserved`. Cette fusion conserve les commits
  publiés Sprint 4 et l'intégration présence/sessions de dev_test.
- Daily et Clock reposent directement sur db4787e.
- Les branches fonctionnelles basées sur la fondation contiendront ses commits
  tant que ce prérequis ne sera pas intégré. Toute PR doit le signaler.
- Aucun merge automatique vers dev_test ou main ; aucun historique réécrit.

## Ownership des fichiers

Chemins Nest relatifs à `srcs/nestJS/42chess`.

| Worker / branche | Autorité exclusive | Coordination |
|---|---|---|
| Matchmaking / feat/matchmaking | src/matchmaking/**, tests associés ; src/games/games.service.ts ; src/realtime/realtime.gateway.ts et realtime.module.ts | Création atomique via EntityManager et notification après commit ; préserver présence/sessions |
| Friends / feat/friends-management | src/friends/**, tests Friends et docs/friends-management.md | Aucun changement de PresenceService |
| Observabilité / feat/observability-metrics | src/metrics/**, games-metrics.service.ts, srcs/grafana/**, tests associés | Producteurs matchmaking/puzzle publiés ou collecteurs PostgreSQL durables ; pas d'édition concurrente des producteurs |
| Daily / feat/daily-puzzle-api | tests puzzle et documentation daily | Réutiliser endpoint existant, sélection UTC |
| Clock / feat/game-clock-sync | src/realtime/game-realtime.service.ts et tests ; client Angular clock/realtime et documentation clock | Ne pas modifier GamesService pendant l'intégration Matchmaking |
| QA / docs/matchmaking | Nouveaux E2E distincts et documentation matchmaking | Tester une version stable publiée ; retourner les défauts d'implémentation au worker Matchmaking |

Toute migration ou modification additionnelle d'un module partagé demande une
réattribution explicite avant édition. Les fixtures PostgreSQL sont isolées par
worker. Les dépendances Docker partagées sont montées en lecture seule avec
caches Vite temporaires.

## Scénarios QA à exécuter

1. Deux sessions authentifiées rejoignent avec un contrôle compatible ; une seule
   partie active existe, avec deux sièges, et chaque socket reçoit MATCH_FOUND
   après commit en référençant cette partie.
2. Plusieurs consommateurs simultanés : aucun utilisateur dans deux parties,
   aucune partie orpheline, FIFO et politique Elo respectées.
3. Sortie effective avant sélection : aucune sélection ultérieure de cette entrée.
   Sortie concurrente à la sélection : résultat cohérent avec l'ordre des commits.
4. Déconnexion/session révoquée : aucune notification privée sur socket non
   autorisé ; état récupérable par HTTP après reconnexion.
5. Erreur lors de la création de partie : rollback des deux entrées et de la
   partie ; aucun MATCH_FOUND publié.
6. Double join, identité falsifiée, jeton absent/révoqué, contrôle invalide,
   partie déjà active : erreurs documentées et aucun état partiellement écrit.
7. Redémarrage du processus et notification manquée : état durable consultable,
   aucune création doublée lors de la reprise du matching.

## Validation de départ

Sur la fondation 12448f0 : build et contrats TypeScript réussis ; 483 tests
unitaires, 324 PostgreSQL, 282 E2E réussis ; lint 0 erreur / 28 avertissements ;
2 dashboards validés ; git diff --check réussi. Les tests incluent Friends,
présence, sessions révocables et concurrence queue. Cette validation ne couvre
pas encore les fonctionnalités nouvelles des branches du sprint.
