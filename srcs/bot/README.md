# Native chess bot

`chess_bot` is a standalone C++17 program, serving JSON over plain WebSocket.
It runs as its own Docker service and uses the existing chess engine's source
(`../chess-engine/src/chess.cpp`) for **all** move generation, legality checks,
position updates and special moves. It does not install, launch, or communicate
with Stockfish. The Stockfish-specific ticket titles are implemented with the
custom `SearchEngine` and `NativeBotAdapter` instead, as requested.

## Run

From the repository root, with g++, make, Boost headers, nlohmann/json headers
and Python 3 installed (Debian: `g++ make libboost-dev nlohmann-json3-dev python3`):

```sh
make -C srcs/bot
make -C srcs/bot test
./srcs/bot/build/chess_bot --host 127.0.0.1 --port 8082
```

`BOT_HOST` and `BOT_PORT` set defaults; CLI arguments override them. The default
is `127.0.0.1:8082`. SIGINT/SIGTERM stop the daemon after bounded in-flight
searches finish. To run in the background locally:

```sh
./srcs/bot/build/chess_bot >bot.log 2>&1 &
bot_pid=$!
# Later: kill "$bot_pid"
```

Both existing Compose stacks include the `bot` service. From `srcs/`:

```sh
docker compose up --build -d bot chess-engine nestjs
# Or:
docker compose -f docker-compose.dev.yml up --build -d bot chess-engine nestjs
```

The Docker build context is **srcs/** (`docker build -f srcs/bot/Dockerfile srcs`).
The image runs unit and real bot/engine WebSocket tests during its build. Its
runtime contains only the bot executable and runtime dependencies and runs as
a non-root user. NestJS receives `BOT_ENGINE_URL=ws://bot:8082`; port 8082 is
reachable inside the Compose network and is not published to the host.

## Search and difficulty

The `BotEngine` interface has a custom `SearchEngine` implementation. Search
uses iterative-deepening negamax, alpha-beta pruning, capture/promotion ordering,
quiescence search (all legal evasions while in check), mate-distance scoring and
a bounded transposition table. Draw evaluation includes supplied repetition
history, halfmove clocks, stalemate and insufficient material. Transposition keys
include the relevant history, so repetition-dependent scores are not reused for
incompatible paths. The table has a 16 MiB key/entry payload budget per search
(allocator/container overhead is additional).

Evaluation combines material, piece centralization, pawn advancement, bishop
pairs, rook placement, king safety/pawn shields and endgame king activity.
Each request owns its search state; matches and clients do not share a board.

| Difficulty | Maximum main depth | Node limit, including quiescence | Search time budget |
| --- | ---: | ---: | ---: |
| EASY | 1 ply | 1,500 | 100 ms |
| MEDIUM | 3 plies | 16,000 | 700 ms |
| HARD | 5 plies | 100,000 | 2,200 ms |

Quiescence extends tactical lines by up to six plies. These are ceilings, not
promises to reach that depth. Time is checked at each search node and is a soft
budget: legal-move generation, initial history replay and final response work
can extend total request duration. Only completed iterations replace the chosen
move. If a budget expires immediately, the result still contains a validated
legal fallback (`depth:0`). There is no random illegal move or implicit queen
promotion. Search is deterministic when the same iterations complete.

HARD finds tested forcing mates in two and avoids elementary material losses;
there is **no measured Elo rating** or claim of Stockfish strength. This is a
bounded practical opponent, not a deep analysis engine.

## WebSocket protocol, version 1

Use **plain WebSocket, not Socket.IO**. One text request produces one text
response. Connections can be reused; responses are ordered per connection.

```json
{"id":"game-42:8","op":"best_move","difficulty":"HARD","moves":["e2e4","e7e5"]}
```

- `id`: optional string, integer or null, echoed in the response.
- `op`: `ping` or `best_move`.
- `difficulty`: required for `best_move`; exactly `EASY`, `MEDIUM` or `HARD`.
- `fen`: optional **initial** FEN; omitted means the normal starting position.
- `moves`: optional ordered UCI moves to replay from that initial position.

Send either current FEN alone, or initial FEN plus its history. Do not send the
current FEN plus the moves that already produced it. Full history is needed to
score repetition correctly. The protocol does not accept client search budgets
or arbitrary unbounded depths. Move strings use lowercase UCI, e.g. `e2e4`,
`e1g1` (castling), `e5d6` (en passant), or `a7a8n` (promotion).

Example response (search statistics vary with hardware):

```json
{"id":"game-42:8","ok":true,"result":{"bestMove":"b1c3","fen":"rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2","fenAfter":"rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 2","difficulty":"HARD","status":"ongoing","scoreCp":0,"depth":4,"nodes":100000,"elapsedMs":1200}}
```

`scoreCp` is relative to the side to move at the request position; positive
means better for that side. Mate scores are near 30000 and favor faster mates.
The `status` describes the input position. For checkmate, stalemate or detected
insufficient material, `bestMove` and `fenAfter` are null; no move is fabricated.
Claimable draws are scored during search but do not automatically terminate the
backend game. Claim handling remains with the game lifecycle.

`ping` returns `{"service":"chess_bot","protocolVersion":1}` in the result.
Errors use `{"id":null,"ok":false,"error":{"code":"invalid_request","message":"..."}}`.
Unknown operations/difficulties, malformed JSON/FEN and illegal history moves
fail safely. Unexpected exceptions return `internal_error`. Invalid requests do
not poison the connection or other searches. Unknown extra fields are ignored.

Resource limits: 128 KiB messages, 2,048 history plies, 64 connections, two search
workers and at most four admitted requests (running plus queued). Busy channels
close with 1013 rather than starting unbounded work; retry later. Binary messages
close with 1003, oversized messages with 1009. Handshake timeout is 10 seconds;
idle timeout is 60 seconds with keep-alive pings. This is an internal,
unauthenticated service; authentication and TLS belong at the NestJS boundary.

## NestJS and persistence

`BotEngine` (TypeScript) and `NativeBotAdapter` provide a typed injectable client
with correlated IDs, response checks, disconnect handling and a 10-second
request timeout. `BotEngineModule` is imported by `GamesModule`; `BotsModule`
exposes the bot-game HTTP endpoints using the existing `GameActorGuard` principal
boundary. No client can choose a bot identity, difficulty on an existing game,
or bypass the rules engine by returning its own bot move.

Apply `AddBotSeats1792278000000` and `AddBotTurnLease1792500000000` through
the normal migration workflow. A seat now contains either `userId` or `botDifficulty`, exclusively,
enforced by a PostgreSQL check. Bot seats have no fake account. Existing human
rows are preserved. Rollback intentionally fails if bot seats remain, rather
than deleting their games to restore a NOT NULL constraint.

The public bot player uses its **seat UUID** as `id`, includes `botDifficulty`,
and has `elo:null` (no calibrated bot rating). Its persisted moves expose that
same seat UUID as `playerId`. Human player IDs and ratings retain their meaning.

### Create a bot game

`POST /v1/games/bot`, with an authenticated `request.user` supplied by the auth
integration, accepts:

```json
{"difficulty":"MEDIUM","color":"WHITE","timeControl":{"initialTime":300000,"increment":2000}}
```

It returns the normal public game state plus `gameId`. The bot plays its opening
move **automatically before this response** if the human chooses BLACK. A failed
opening still returns the durable ID, `botPending:true` and a safe error code;
the frontend does not need a separate successful opening request.

Only **one ACTIVE bot game per account** is allowed. Creation locks the account
row briefly, checks existing bot seats, and inserts the game atomically. This
also prevents concurrent requests/replicas from bypassing the limit. Finish,
resign or settle a timed-out bot game before starting another. Other human-only
games are not counted. The limit returns `BOT_GAME_LIMIT` (409).

### Play, status and retry

`POST /v1/games/:id/bot/player-move` accepts `{ "uci":"e2e4" }`. It saves the
human move, computes the bot reply, and returns the normal game state. The
existing `GamesService.play()` performs the same orchestration for realtime
transports. A response can contain **two new plies**: consumers must publish all
new moves in order, not just the final row.

Public create/move/retry/GET responses include:

| Field | Meaning |
| --- | --- |
| `botPending` | The game is ACTIVE and its next move belongs to a bot |
| `botThinking` | A worker currently holds an unexpired reservation for that move |
| `botError` | `null`, `BOT_UNAVAILABLE` or `INVALID_BOT_RESPONSE`; no internal error text |

A crash, timeout or invalid bot response does **not** turn an already accepted
human move into an API error. The normal successful response contains that move
and reports `botPending:true`, `botThinking:false`, and `botError`. The frontend
may retry `POST /v1/games/:id/bot-move`; it must not replay the human move. This
also handles a failed bot opening. Retry requires a participant and is idempotent
when the bot has already played or another worker is computing. Database failures
still propagate normally; no API can guarantee a successful response while its
state store is unavailable.

### Short database transactions

Bot turns use three distinct phases:

1. Briefly lock the game, authorize the participant, settle clocks and reserve
   the bot turn with a random token and a **45-second lease**, then commit.
2. **Without a transaction, game lock or pooled database connection**, replay and
   validate the position, ask the bot for a move, and verify that move and its
   resulting FEN through the rules daemon.
3. Reacquire the game lock and check token ownership, lease expiry, ACTIVE status,
   initial/current FEN, turn, move count/history and bot seat. If still current,
   settle the bot clock and save through the normal SAN/history/clock/result path.

A changed/finished position discards the computed result. Resignation and clock
settlement can complete while search is running. Duplicate bot requests observe
the reservation and return current state without launching another search.
Human moves on the bot's turn are rejected immediately. A dead worker's expired
lease can be reclaimed on retry; an old worker cannot save over or clear a newer
worker's lease. No long-running computation holds a database connection.

On bot error, only the matching reservation is cleared and a pending/error
state is saved. Calculation and validation time consume the bot clock; if it
expires, the timeout result is saved without a move. Lease tokens and deadlines
are internal and never returned publicly.

Draw offers (`OFFER_DRAW`) against a bot return `BOT_DRAW_UNSUPPORTED` (409)
without storing a pending offer. Rule-based draw claims and resignation retain
the existing game behavior. Bot games carry explicit bot seats for the rating
integration to exclude; rating and realtime-handler changes owned by other PRs
are not duplicated here.

## Tests

From the repository root:

```sh
make -C srcs/bot check
# Run the same native and transport checks in Docker:
make test-bot
(cd srcs/nestJS/42chess && npm ci && npm run build && npm test)
(cd srcs/nestJS/42chess && npm run test:bot-adapter)
# Real PostgreSQL + both daemons + backend integration/HTTP tests:
make test
```

The final command first runs `test-bot` inside Docker, then uses the existing
Docker backend test stack, including the `bot-test` daemon.
For host execution, start that stack with `npm run test:db:up` in the NestJS app,
then use `npm run test:db`. Override `TEST_BOT_ENGINE_URL` and
`TEST_CHESS_ENGINE_URL` when the daemons are not at the fixture defaults.

- C++ tests cover every difficulty, pins, check evasions, both colors, special
  moves, forced mates, hanging-queen capture, deterministic fixed-depth results,
  legal fallback, search limits, invalid input and terminal positions.
- Python socket tests run both actual daemons and have the rules service
  independently confirm chosen moves and resulting FENs. They also cover
  fragmentation, malformed requests, concurrency, frame limits and shutdown.
- The Node script exercises the **compiled** NestJS adapter against both daemons.
- Backend unit tests exercise normal persistence orchestration, illegal/stale
  reply rejection, recovery after failure, lock conflicts and bot clock expiry
  using transaction doubles; they do not claim to verify PostgreSQL.
- `test/bot-games.integration-spec.ts` verifies the actual migration constraints,
  durable moves, account-creation locks/caps, non-blocking search, stale-result
  rejection, failure/retry and bot player presentation against PostgreSQL and
  both real executables.
- `test/bot-controller.e2e-spec.ts` exercises the real Nest HTTP controller,
  authentication boundary, DTO validation, pending-state response and error codes.
  Run `npm run test:bot-http` without PostgreSQL; the full e2e stack includes it too.
- `test:all` (hence root `make test`) includes `nest_adapter_test.mjs`. In Docker
  it targets the bot/rules services; standalone it launches both local daemons.

See `VALIDATION.md` for what was executed in the implementation environment.

## Ticket mapping

| Issue | Custom implementation |
| --- | --- |
| SCRUM-287 / BOT-01 | **Compiler et installer le bot maison** (replacement title for the tracker) |
| SCRUM-288 / BOT-02 | C++ and NestJS `BotEngine` interfaces |
| SCRUM-289 / BOT-03 | `SearchEngine` and `NativeBotAdapter`, replacing the Stockfish adapter |
| SCRUM-290 / BOT-04 | Correlated JSON WebSocket requests with bounded workers/timeouts |
| SCRUM-291 / BOT-05 | Initial FEN and UCI history input/replay |
| SCRUM-292 / BOT-06 | `best_move`, legal fallback and search statistics |
| SCRUM-293 / BOT-07 | Protocol, adapter and game-domain errors; safe retry |
| SCRUM-294 / BOT-08 | EASY profile |
| SCRUM-295 / BOT-09 | MEDIUM profile |
| SCRUM-296 / BOT-10 | HARD profile |
| SCRUM-299 / BOT-13 | PostgreSQL bot seats, normal move persistence, replay and restart |
| SCRUM-301 / BOT-15 | Short turn reservations, outside-transaction calculation and stale-result checks |
| SCRUM-302 / BOT-16 | Difficulty, tactical, legality, transport and integration tests |

## Code layout and build targets

C++ declarations live in `include/bot/*.hpp`; implementations live in matching
source files. `search.cpp` owns search implementation, `evaluation.cpp` owns
position scoring, and `main.cpp`, `listener.cpp` and `session.cpp` own process
startup and transport. The source files do not contain class/struct definitions.
Tabs and expanded control flow are enforced by `.clang-format`; `.editorconfig`
records tab indentation for this directory. Run `make -C srcs/bot format-check`
with clang-format 15 or newer to check the C++ style.

The Makefile compiles each source to its own object with automatic header
tracking (`-MMD -MP`), then links the executable and tests from shared objects.
It honors `CPPFLAGS`, `CXXFLAGS`, `LDFLAGS` and `LDLIBS`. `test` runs the C++
checks, `integration-test` builds both daemons and runs the real socket tests,
and `check` runs both. `clean` removes objects/dependency files; `fclean` also
removes the two binaries; `re` rebuilds the daemon.

`make test-bot` at the repository root (or `make -C srcs/bot docker-test`)
builds the Docker `test` stage and runs its `make check` command in a container.
Root `make test` depends on that target. Normal production image builds also
must pass the `test` stage because the runtime copies its binary from that stage.
The backend's Docker test stack continues to run NestJS unit, PostgreSQL and
HTTP tests against the real engine and bot services.
