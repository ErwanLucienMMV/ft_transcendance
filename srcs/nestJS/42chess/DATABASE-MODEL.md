# Modèle de données PostgreSQL (DOC-07 / SCRUM-514)

Ce document décrit le schéma réellement obtenu après application des migrations
sur PostgreSQL 15, à partir de `dev_test` (`779e654`) et des branches DB associées.
Les migrations dans `src/database/migrations` sont la source de vérité ;
`synchronize`, `dropSchema` et `migrationsRun` sont désactivés. Appliquer les
migrations explicitement avant de démarrer la nouvelle version de l’API.

Voir le [diagramme relationnel](../../../docs/database-diagram.md), le
[guide de connexion et migrations](DATABASE.md), les
[données de développement](DEVELOPMENT-DATA.md).

## Conventions et garanties

- Les identifiants sont des UUID générés par `uuid_generate_v4()` ; les dates
  d’événements utilisent `timestamptz`. `daily_puzzles.date` est une date civile
  choisie explicitement par le service (convention recommandée : UTC).
- Les noms SQL camelCase doivent être cités, par exemple `"userId"`.
- `users.email` est nullable, unique et stocké en minuscules. PostgreSQL autorise
  plusieurs valeurs NULL. Le username conserve sa casse d’affichage mais son
  unicité est aussi vérifiée sur `lower(username)`.
- `createdAt` est initialisé en base. `updatedAt` est géré par TypeORM ; les
  écritures SQL directes doivent le mettre à jour explicitement.
- Les champs de mot de passe, vérification et 2FA sont internes : ne pas
  sérialiser directement une entité utilisateur dans une réponse publique.
  Les secrets 2FA nécessitent les mêmes protections que les identifiants.
- Les contrôles FEN et légalité des coups appartiennent au moteur d’échecs. Les
  contraintes SQL des puzzles imposent une position non vide et une solution
  non vide sans élément NULL, sans prétendre valider les règles d’échecs.
- Une amitié est stockée une seule fois, avec `userId < friendId`. Les services
  trient les deux UUID et recherchent les deux colonnes. Une seule demande en
  attente est autorisée par paire non orientée ; les demandes terminées restent
  historisables. L’acceptation et l’insertion d’amitié doivent être atomiques.
- Un compte OAuth peut avoir plusieurs identités. La paire
  `(provider, providerUserId)` est unique ; le service normalise les noms de
  provider et vérifie la propriété avant de lier un compte. Aucun token OAuth
  n’est stocké dans cette table et aucun endpoint OAuth n’est ajouté ici.
- `messages` et `game_messages` stockent un contenu non vide (2000 caractères
  maximum). Autorisation d’accès, modération et appartenance à une partie sont
  des responsabilités des services, pas des garanties de ces tables.
- `rating_history` contient les snapshots avant/après, une fois par utilisateur
  et partie. Le calcul et la mise à jour du classement doivent être atomiques
  avec l’écriture de l’historique. Aucun trigger ne calcule le classement.
- `matchmaking_queue` autorise une entrée par utilisateur. Les durées sont des
  millisecondes, le classement est capturé à l’entrée. L’index couvre égalité
  sur le contrôle de temps puis intervalle de classement ; le service doit
  encore gérer l’expiration, l’équité et la réservation concurrente des joueurs.
- `puzzle_attempts` autorise plusieurs essais par utilisateur/puzzle. `solved`
  et les coups enregistrés doivent être déterminés par le service.

## Relations et suppression

Les nouvelles clés étrangères utilisent `RESTRICT` : la suppression d’un parent
référencé échoue et ne supprime pas silencieusement l’historique. Les relations
existantes `games -> game_players/moves` gardent leur politique `CASCADE` ;
les nouvelles références vers une partie peuvent désormais empêcher sa
suppression. L’anonymisation, la rétention et la suppression de compte restent
à définir avant d’exposer un endpoint de suppression.

Les colonnes `gameId` et `color` d’un coup référencent ensemble un siège de la
même partie. Le lifecycle des parties vérifie la cohérence entre statut,
résultat et dates. Un clock JSON absent reste autorisé pour les anciens exemples,
mais le service exige une horloge valide pour jouer une partie active.

## Dictionnaire des tables

Les contraintes et index ci-dessous proviennent du catalogue PostgreSQL après
migration. Le schéma isolé de validation est omis des noms pour la lisibilité.
`typeorm_migrations` est réservé à TypeORM et ne contient pas de données métier.

### `daily_puzzles`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `puzzleId` | `uuid` | non | `—` |
| `date` | `date` | non | `—` |

Contraintes :

- `FK_daily_puzzles_puzzleId`: `FOREIGN KEY ("puzzleId") REFERENCES puzzles(id) ON DELETE RESTRICT`
- `UQ_daily_puzzles_0`: `UNIQUE (date)`
- `daily_puzzles_pkey`: `PRIMARY KEY (id)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE UNIQUE INDEX "UQ_daily_puzzles_0" ON daily_puzzles USING btree (date)`
- `CREATE UNIQUE INDEX daily_puzzles_pkey ON daily_puzzles USING btree (id)`

### `friend_requests`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `senderId` | `uuid` | non | `—` |
| `recipientId` | `uuid` | non | `—` |
| `status` | `character varying(8)` | non | `'PENDING'::character varying` |

Contraintes :

- `CHK_friend_requests_0`: `CHECK (("senderId" <> "recipientId"))`
- `CHK_friend_requests_1`: `CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'ACCEPTED'::character varying, 'REJECTED'::character varying])::text[])))`
- `FK_friend_requests_recipientId`: `FOREIGN KEY ("recipientId") REFERENCES users(id) ON DELETE RESTRICT`
- `FK_friend_requests_senderId`: `FOREIGN KEY ("senderId") REFERENCES users(id) ON DELETE RESTRICT`
- `friend_requests_pkey`: `PRIMARY KEY (id)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE UNIQUE INDEX "UQ_friend_requests_pending_pair" ON friend_requests USING btree (LEAST("senderId", "recipientId"), GREATEST("senderId", "recipientId")) WHERE ((status)::text = 'PENDING'::text)`
- `CREATE UNIQUE INDEX friend_requests_pkey ON friend_requests USING btree (id)`

### `friendships`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `userId` | `uuid` | non | `—` |
| `friendId` | `uuid` | non | `—` |

Contraintes :

- `CHK_friendships_0`: `CHECK (("userId" < "friendId"))`
- `FK_friendships_friendId`: `FOREIGN KEY ("friendId") REFERENCES users(id) ON DELETE RESTRICT`
- `FK_friendships_userId`: `FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT`
- `UQ_friendships_1`: `UNIQUE ("userId", "friendId")`
- `friendships_pkey`: `PRIMARY KEY (id)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE UNIQUE INDEX "UQ_friendships_1" ON friendships USING btree ("userId", "friendId")`
- `CREATE UNIQUE INDEX friendships_pkey ON friendships USING btree (id)`

### `game_messages`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `gameId` | `uuid` | non | `—` |
| `userId` | `uuid` | non | `—` |
| `content` | `character varying(2000)` | non | `—` |

Contraintes :

- `CHK_game_messages_0`: `CHECK ((length(btrim((content)::text)) > 0))`
- `FK_game_messages_gameId`: `FOREIGN KEY ("gameId") REFERENCES games(id) ON DELETE RESTRICT`
- `FK_game_messages_userId`: `FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT`
- `game_messages_pkey`: `PRIMARY KEY (id)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE INDEX "IDX_game_messages_history" ON game_messages USING btree ("gameId", "createdAt", id)`
- `CREATE UNIQUE INDEX game_messages_pkey ON game_messages USING btree (id)`

### `game_players`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `gameId` | `uuid` | non | `—` |
| `userId` | `uuid` | non | `—` |
| `color` | `character varying(5)` | non | `—` |
| `joinedAt` | `timestamp with time zone` | non | `now()` |

Contraintes :

- `CHK_game_players_color`: `CHECK (((color)::text = ANY ((ARRAY['WHITE'::character varying, 'BLACK'::character varying])::text[])))`
- `FK_game_players_game`: `FOREIGN KEY ("gameId") REFERENCES games(id) ON DELETE CASCADE`
- `FK_game_players_user`: `FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT`
- `PK_game_players`: `PRIMARY KEY (id)`
- `UQ_game_players_color`: `UNIQUE ("gameId", color)`
- `UQ_game_players_user`: `UNIQUE ("gameId", "userId")`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE INDEX "IDX_game_players_userId" ON game_players USING btree ("userId", "gameId")`
- `CREATE UNIQUE INDEX "PK_game_players" ON game_players USING btree (id)`
- `CREATE UNIQUE INDEX "UQ_game_players_color" ON game_players USING btree ("gameId", color)`
- `CREATE UNIQUE INDEX "UQ_game_players_user" ON game_players USING btree ("gameId", "userId")`

### `games`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `status` | `character varying(8)` | non | `'WAITING'::character varying` |
| `initialFen` | `text` | non | `'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'::text` |
| `currentFen` | `text` | non | `'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'::text` |
| `turn` | `character varying(5)` | non | `'WHITE'::character varying` |
| `initialTime` | `integer` | non | `—` |
| `increment` | `integer` | non | `0` |
| `result` | `character varying(9)` | oui | `—` |
| `startedAt` | `timestamp with time zone` | oui | `—` |
| `finishedAt` | `timestamp with time zone` | oui | `—` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `updatedAt` | `timestamp with time zone` | non | `now()` |
| `drawOffer` | `character varying(5)` | oui | `—` |
| `endReason` | `character varying(24)` | oui | `—` |
| `clock` | `jsonb` | oui | `—` |
| `clockDeadline` | `timestamp with time zone` | oui | `—` |
| `invitedOpponentId` | `uuid` | oui | `—` |

Contraintes :

- `CHK_games_clock`: `CHECK (((clock IS NULL) OR (jsonb_typeof(clock) = 'object'::text)))`
- `CHK_games_clock_deadline`: `CHECK ((("clockDeadline" IS NULL) OR ((status)::text = 'ACTIVE'::text)))`
- `CHK_games_draw_offer`: `CHECK ((("drawOffer" IS NULL) OR (((status)::text = 'ACTIVE'::text) AND (("drawOffer")::text = ANY ((ARRAY['WHITE'::character varying, 'BLACK'::character varying])::text[])))))`
- `CHK_games_end_reason`: `CHECK ((("endReason" IS NULL) OR (((status)::text = 'FINISHED'::text) AND (("endReason")::text = ANY ((ARRAY['CHECKMATE'::character varying, 'RESIGNATION'::character varying, 'TIMEOUT'::character varying, 'DRAW_AGREEMENT'::character varying, 'STALEMATE'::character varying, 'INSUFFICIENT_MATERIAL'::character varying, 'THREEFOLD_REPETITION'::character varying, 'FIFTY_MOVE_RULE'::character varying])::text[])))))`
- `CHK_games_finish_time`: `CHECK (("finishedAt" >= "startedAt"))`
- `CHK_games_lifecycle`: `CHECK (((((status)::text = 'WAITING'::text) AND ("startedAt" IS NULL) AND ("finishedAt" IS NULL) AND (result IS NULL)) OR (((status)::text = 'ACTIVE'::text) AND ("startedAt" IS NOT NULL) AND ("finishedAt" IS NULL) AND (result IS NULL)) OR (((status)::text = 'FINISHED'::text) AND ("startedAt" IS NOT NULL) AND ("finishedAt" IS NOT NULL) AND (result IS NOT NULL))))`
- `CHK_games_position`: `CHECK (((length(btrim("initialFen")) > 0) AND (length(btrim("currentFen")) > 0)))`
- `CHK_games_result`: `CHECK (((result)::text = ANY ((ARRAY['WHITE_WIN'::character varying, 'BLACK_WIN'::character varying, 'DRAW'::character varying])::text[])))`
- `CHK_games_status`: `CHECK (((status)::text = ANY ((ARRAY['WAITING'::character varying, 'ACTIVE'::character varying, 'FINISHED'::character varying])::text[])))`
- `CHK_games_time_control`: `CHECK ((("initialTime" > 0) AND (increment >= 0)))`
- `CHK_games_turn`: `CHECK (((turn)::text = ANY ((ARRAY['WHITE'::character varying, 'BLACK'::character varying])::text[])))`
- `FK_games_invited_opponent`: `FOREIGN KEY ("invitedOpponentId") REFERENCES users(id) ON DELETE RESTRICT`
- `PK_games`: `PRIMARY KEY (id)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE INDEX "IDX_games_clock_deadline" ON games USING btree ("clockDeadline", id) WHERE ((status)::text = 'ACTIVE'::text)`
- `CREATE INDEX "IDX_games_createdAt" ON games USING btree ("createdAt", id)`
- `CREATE INDEX "IDX_games_invited_opponent" ON games USING btree ("invitedOpponentId")`
- `CREATE INDEX "IDX_games_status_createdAt" ON games USING btree (status, "createdAt", id)`
- `CREATE UNIQUE INDEX "PK_games" ON games USING btree (id)`

### `matchmaking_queue`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `userId` | `uuid` | non | `—` |
| `rating` | `integer` | non | `—` |
| `initialTime` | `integer` | non | `—` |
| `increment` | `integer` | non | `0` |

Contraintes :

- `CHK_matchmaking_queue_1`: `CHECK (((rating >= 0) AND ("initialTime" > 0) AND (increment >= 0)))`
- `FK_matchmaking_queue_userId`: `FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT`
- `UQ_matchmaking_queue_0`: `UNIQUE ("userId")`
- `matchmaking_queue_pkey`: `PRIMARY KEY (id)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE INDEX "IDX_matchmaking_lookup" ON matchmaking_queue USING btree ("initialTime", increment, rating, "createdAt", id)`
- `CREATE UNIQUE INDEX "UQ_matchmaking_queue_0" ON matchmaking_queue USING btree ("userId")`
- `CREATE UNIQUE INDEX matchmaking_queue_pkey ON matchmaking_queue USING btree (id)`

### `messages`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `senderId` | `uuid` | non | `—` |
| `recipientId` | `uuid` | non | `—` |
| `content` | `character varying(2000)` | non | `—` |

Contraintes :

- `CHK_messages_0`: `CHECK (("senderId" <> "recipientId"))`
- `CHK_messages_1`: `CHECK ((length(btrim((content)::text)) > 0))`
- `FK_messages_recipientId`: `FOREIGN KEY ("recipientId") REFERENCES users(id) ON DELETE RESTRICT`
- `FK_messages_senderId`: `FOREIGN KEY ("senderId") REFERENCES users(id) ON DELETE RESTRICT`
- `messages_pkey`: `PRIMARY KEY (id)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE INDEX "IDX_messages_conversation" ON messages USING btree ("senderId", "recipientId", "createdAt", id)`
- `CREATE UNIQUE INDEX messages_pkey ON messages USING btree (id)`

### `moves`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `gameId` | `uuid` | non | `—` |
| `color` | `character varying(5)` | non | `—` |
| `ply` | `integer` | non | `—` |
| `uci` | `character varying(5)` | non | `—` |
| `fenAfter` | `text` | non | `—` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `notation` | `character varying(16)` | oui | `—` |

Contraintes :

- `CHK_moves_ply`: `CHECK ((ply > 0))`
- `CHK_moves_position`: `CHECK ((length(btrim("fenAfter")) > 0))`
- `CHK_moves_uci`: `CHECK ((((uci)::text ~ '^[a-h][1-8][a-h][1-8][qrbn]?$'::text) AND ("left"((uci)::text, 2) <> "substring"((uci)::text, 3, 2))))`
- `FK_moves_game`: `FOREIGN KEY ("gameId") REFERENCES games(id) ON DELETE CASCADE`
- `FK_moves_player`: `FOREIGN KEY ("gameId", color) REFERENCES game_players("gameId", color)`
- `PK_moves`: `PRIMARY KEY (id)`
- `UQ_moves_ply`: `UNIQUE ("gameId", ply)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE UNIQUE INDEX "PK_moves" ON moves USING btree (id)`
- `CREATE UNIQUE INDEX "UQ_moves_ply" ON moves USING btree ("gameId", ply)`

### `oauth_accounts`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `userId` | `uuid` | non | `—` |
| `provider` | `character varying(32)` | non | `—` |
| `providerUserId` | `character varying(255)` | non | `—` |

Contraintes :

- `CHK_oauth_accounts_1`: `CHECK (((length(btrim((provider)::text)) > 0) AND (length(btrim(("providerUserId")::text)) > 0)))`
- `FK_oauth_accounts_userId`: `FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT`
- `UQ_oauth_accounts_0`: `UNIQUE (provider, "providerUserId")`
- `oauth_accounts_pkey`: `PRIMARY KEY (id)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE UNIQUE INDEX "UQ_oauth_accounts_0" ON oauth_accounts USING btree (provider, "providerUserId")`
- `CREATE UNIQUE INDEX oauth_accounts_pkey ON oauth_accounts USING btree (id)`

### `puzzle_attempts`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `userId` | `uuid` | non | `—` |
| `puzzleId` | `uuid` | non | `—` |
| `solved` | `boolean` | non | `false` |
| `moves` | `text[]` | non | `'{}'::text[]` |

Contraintes :

- `CHK_puzzle_attempts_0`: `CHECK ((array_position(moves, NULL::text) IS NULL))`
- `FK_puzzle_attempts_puzzleId`: `FOREIGN KEY ("puzzleId") REFERENCES puzzles(id) ON DELETE RESTRICT`
- `FK_puzzle_attempts_userId`: `FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT`
- `puzzle_attempts_pkey`: `PRIMARY KEY (id)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE INDEX "IDX_puzzle_attempts_user" ON puzzle_attempts USING btree ("userId", "puzzleId", "createdAt")`
- `CREATE UNIQUE INDEX puzzle_attempts_pkey ON puzzle_attempts USING btree (id)`

### `puzzles`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `fen` | `text` | non | `—` |
| `solution` | `text[]` | non | `—` |
| `rating` | `integer` | non | `1200` |

Contraintes :

- `CHK_puzzles_0`: `CHECK ((length(btrim(fen)) > 0))`
- `CHK_puzzles_1`: `CHECK (((cardinality(solution) > 0) AND (array_position(solution, NULL::text) IS NULL)))`
- `CHK_puzzles_2`: `CHECK ((rating >= 0))`
- `puzzles_pkey`: `PRIMARY KEY (id)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE UNIQUE INDEX puzzles_pkey ON puzzles USING btree (id)`

### `rating_history`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `userId` | `uuid` | non | `—` |
| `gameId` | `uuid` | non | `—` |
| `ratingBefore` | `integer` | non | `—` |
| `ratingAfter` | `integer` | non | `—` |

Contraintes :

- `CHK_rating_history_1`: `CHECK ((("ratingBefore" >= 0) AND ("ratingAfter" >= 0)))`
- `FK_rating_history_gameId`: `FOREIGN KEY ("gameId") REFERENCES games(id) ON DELETE RESTRICT`
- `FK_rating_history_userId`: `FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT`
- `UQ_rating_history_0`: `UNIQUE ("userId", "gameId")`
- `rating_history_pkey`: `PRIMARY KEY (id)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE UNIQUE INDEX "UQ_rating_history_0" ON rating_history USING btree ("userId", "gameId")`
- `CREATE UNIQUE INDEX rating_history_pkey ON rating_history USING btree (id)`

### `users`

| Colonne | Type PostgreSQL | NULL autorisé | Défaut |
| --- | --- | --- | --- |
| `id` | `uuid` | non | `uuid_generate_v4()` |
| `username` | `character varying(32)` | non | `—` |
| `email` | `character varying(254)` | oui | `—` |
| `passwordHash` | `character varying(255)` | oui | `—` |
| `avatarUrl` | `character varying(2048)` | oui | `—` |
| `elo` | `integer` | non | `1200` |
| `gamesPlayed` | `integer` | non | `0` |
| `gamesWon` | `integer` | non | `0` |
| `gamesDraw` | `integer` | non | `0` |
| `gamesLost` | `integer` | non | `0` |
| `lastSeenAt` | `timestamp with time zone` | oui | `—` |
| `createdAt` | `timestamp with time zone` | non | `now()` |
| `updatedAt` | `timestamp with time zone` | non | `now()` |
| `emailVerifiedAt` | `timestamp with time zone` | oui | `—` |
| `emailVerificationTokenHash` | `character varying(64)` | oui | `—` |
| `emailVerificationExpiresAt` | `timestamp with time zone` | oui | `—` |
| `twoFactorSecret` | `character varying(64)` | oui | `—` |
| `twoFactorEnabledAt` | `timestamp with time zone` | oui | `—` |
| `twoFactorLastTimeStep` | `integer` | oui | `—` |
| `twoFactorFailedAttempts` | `integer` | non | `0` |
| `twoFactorLockedUntil` | `timestamp with time zone` | oui | `—` |

Contraintes :

- `CHK_users_email_lowercase`: `CHECK (((email)::text = lower((email)::text)))`
- `PK_a3ffb1c0c8416b9fc6f907b7433`: `PRIMARY KEY (id)`
- `UQ_97672ac88f789774dd47f7c8be3`: `UNIQUE (email)`
- `UQ_b3b08b9bfa724a55e787c5b8fe5`: `UNIQUE ("emailVerificationTokenHash")`
- `UQ_fe0bb3f6520ee0469504521e710`: `UNIQUE (username)`

Index (y compris ceux créés par les clés primaires et uniques) :

- `CREATE UNIQUE INDEX "PK_a3ffb1c0c8416b9fc6f907b7433" ON users USING btree (id)`
- `CREATE UNIQUE INDEX "UQ_97672ac88f789774dd47f7c8be3" ON users USING btree (email)`
- `CREATE UNIQUE INDEX "UQ_b3b08b9bfa724a55e787c5b8fe5" ON users USING btree ("emailVerificationTokenHash")`
- `CREATE UNIQUE INDEX "UQ_fe0bb3f6520ee0469504521e710" ON users USING btree (username)`
- `CREATE UNIQUE INDEX "UQ_users_username_lower" ON users USING btree (lower((username)::text))`

## Exemples de lecture

```sql
-- Amis d’un utilisateur (les deux orientations sont nécessaires).
SELECT CASE WHEN "userId" = $1 THEN "friendId" ELSE "userId" END AS "friendId"
FROM friendships WHERE "userId" = $1 OR "friendId" = $1;

-- Candidats compatibles ; le service réserve les lignes dans une transaction.
SELECT * FROM matchmaking_queue
WHERE "initialTime" = $1 AND increment = $2
  AND rating BETWEEN $3 AND $4 AND "userId" <> $5
ORDER BY rating, "createdAt", id LIMIT 20 FOR UPDATE SKIP LOCKED;

-- Historique des essais d’un utilisateur pour un puzzle.
SELECT * FROM puzzle_attempts WHERE "userId" = $1 AND "puzzleId" = $2
ORDER BY "createdAt", id;
```

## Validation et exploitation

Depuis le backend : `npm run build`, `npm test`, `npm run lint`,
`npm run test:db`, `npm run test:e2e`. Les deux derniers nécessitent les services
de test PostgreSQL et moteur d’échecs décrits dans `DATABASE.md`.
Les tests créent des schémas aléatoires dans la base de test uniquement.

Avant déploiement : sauvegarde selon [BACKUP.md](../../../BACKUP.md), revue des
migrations, application explicite avec `npm run migration:run`. Les migrations
ajoutent des tables sans réécrire les données existantes. La commande
`migration:revert` peut supprimer les nouvelles tables et leurs données : elle
nécessite une revue et une approbation opérationnelle. Les seeds sont un outil
de développement manuel ; ne jamais les exécuter en production.
