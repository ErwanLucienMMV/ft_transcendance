# PR #60 — corrections après review, 26 octobre 2026

Ce rapport complète le [relevé initial](review-readiness-2026-10-26.md).
La référence fonctionnelle est **Proposition spec.md**, confirmée par
l’utilisateur le 26 octobre (fichier local non suivi), et le sujet fourni
`ft_transcendence.pdf`. Les mentions antérieures de « These.md » désignent cette
proposition. Les contrats auth et puzzle existants ont également été relus.

## Intégration de dev_test

La PR puzzle #58 a été fusionnée dans `dev_test` à `e6cb745` après la préparation
initiale de notre PR. Cette cible est intégrée dans la branche de #60 par un
commit de fusion, conservant les commits des deux auteurs. Aucun push forcé,
aucune fusion de #60 dans `dev_test` et aucune modification de la branche du
collaborateur ne sont effectués.

Trois conflits étaient présents :

- `access-token.guard.ts` : conservation de l’adaptateur `AuthGuard`, qui vérifie
  la session persistée et révocable et garde le contrat d’erreur `AUTH_REQUIRED`.
  Les tokens `typ=access` sont acceptés uniquement avec une session valide ; les
  anciens tokens stateless, challenges 2FA et tokens forgés/expirés sont refusés.
- `auth.module.ts` : combinaison des imports/providers/exports des deux branches,
  incluant `SessionModule`, `AuthService`, `AccessTokenGuard` et `JwtModule`.
  `PuzzlesModule` importe aussi `SessionModule`, nécessaire pour résoudre le
  guard partagé dans son propre contexte NestJS.
- `ticket-schema.integration-spec.ts` : conservation du nombre dynamique de
  migrations et des assertions de suppression/restauration des tables sessions
  et OAuth, ainsi que des données utilisateur.

Les fixtures puzzle émettent maintenant de vraies sessions via `SessionService`.
Leur DataSource connaît `AuthSession` et leur configuration utilise la validation
normale du backend. Le test de rollback puzzle revient jusqu’à
`AddPuzzleTraining1792600000000`, même si des migrations plus récentes suivent,
puis vérifie la réapplication exacte et la conservation du puzzle existant.
Ces rollbacks concernent uniquement les schémas de test jetables.

## Dernière méthode OAuth utilisable

Avant la correction, un compte sans mot de passe pouvait retirer Google si une
identité GitHub restait liée, même quand GitHub était désactivé côté serveur.
Après déconnexion, aucune méthode configurée ne permettait sa reconnexion.

`OAuthService.unlink()` consulte désormais les fournisseurs configurés, avec
la même règle que l’API de disponibilité. En l’absence de mot de passe, une
autre identité liée **et configurée** doit rester ; sinon, le serveur répond
`409 OAUTH_LAST_LOGIN_METHOD` sans supprimer le lien. Le verrou transactionnel
sur l’utilisateur reste en place pour sérialiser deux retraits concurrents.
Un compte local conserve sa possibilité de retirer ses liens OAuth, et un lien
désactivé peut être retiré lorsqu’un autre moyen utilisable subsiste.

Les régressions HTTP vérifient les deux fournisseurs désactivés à tour de rôle,
la conservation des liens après refus, le retrait d’un lien indisponible, une
reconnexion réelle par le fournisseur restant et deux retraits concurrents.
Seul le trafic sortant vers les fournisseurs est simulé ; HTTP, sessions et
PostgreSQL restent réels dans cette suite.

## Respect des contrats

| Référence | Comportement conservé ou vérifié |
| --- | --- |
| Proposition §3 et §40, règle 3 | Connexion locale préservée ; Google/GitHub optionnels ; retrait protégé côté serveur. |
| Proposition §3.3 et §15 | Logout révoque la session courante ; jeu, WebSocket, profil et puzzles utilisent la vérification de session partagée. |
| Proposition §30–34 | Solutions puzzle non divulguées, identité du propriétaire issue de la session et enveloppe d’erreur conservées. |
| Proposition §37 et §40 | Règles de jeu côté serveur, état persistant PostgreSQL, aucune dépendance OAuth du moteur C++. |
| Sujet : authentification, validation et confidentialité | Aucun secret ajouté, aucune validation ou protection 2FA retirée, configuration HTTPS de production inchangée. |

Le test puzzle après logout vérifie le refus de création, consultation et coup
avec la session révoquée, sans modifier la progression ni invalider une autre
session du même utilisateur. Les tests de propriété, concurrence, moteur et
absence de solution restent exécutés.

L’écart préexistant de l’inscription (vérification d’e-mail avant connexion,
contrairement au token immédiat montré dans la proposition §3.1) reste documenté
dans le relevé initial. Cette correction ne supprime pas cette protection.
Le raccordement de la présence et la validation OAuth du domaine final restent
des travaux distincts ; aucune fonctionnalité supplémentaire n’est annoncée.

## Validation locale

Node 22.23.1 ; PostgreSQL 15 et vrais démons C++ lancés avec Podman Compose dans
le projet isolé `ft-pr60-review`. Base de test en tmpfs, ports 56432/56433/56434,
aucun volume ou service applicatif existant utilisé.

| Contrôle | Résultat |
| --- | --- |
| `npm run test:all` : contrats TypeScript | Réussi |
| Tests unitaires backend | 320 réussis, 30 fichiers |
| Tests PostgreSQL | 235 réussis, 17 fichiers |
| Tests HTTP/WebSocket | 128 réussis, 13 fichiers |
| Total des trois suites backend | **683 réussis** |
| Build NestJS | Réussi |
| Adaptateur Nest vers les vrais démons bot/moteur | Réussi |
| Build du service bot : tests natifs et transport | 112 contrôles bot et transport réel réussis |
| Lint backend | 0 erreur, 28 avertissements préexistants ; aucun avertissement masqué |

Les tests locaux couvrent l’intégration auth/puzzles ; les résultats du frontend
déjà relevés dans le rapport initial ne sont pas présentés comme une nouvelle
exécution locale. Les workflows habituels doivent être contrôlés sur la nouvelle
tête de PR après son push.

Rapports locaux de cette exécution : `/tmp/ft-pr60-docs/backend-all.log`,
`backend-lint.log`, `oauth-final.log` et `test-services.log`. Ils ne sont pas
committés. Le checkout de travail est `/goinfre/hcombaud/ft-transcendance-pr60` ;
le checkout initial de `dev_test` et ses documents personnels sont préservés.
