# feat(bot): add native chess opponent, WebSocket service and persisted bot turns

Target branch: `dev_test` (base shared with the existing `feat/bot` branch).
Source branch: `feat/bot`.

The bot feature currently has no implementation. This adds a standalone custom
C++ opponent that NestJS can query and connects bot turns to the existing
persisted game lifecycle.

## Changes

- Add `srcs/bot/chess_bot`, built as an executable and deployed as its own
  internal Docker service. Use the existing C++ chess rules implementation for
  legal generation, special moves and final move validation.
- Implement iterative-deepening alpha-beta/negamax search with quiescence,
  move ordering, material/positional evaluation and a bounded transposition table.
  EASY, MEDIUM and HARD have separate depth, node and time budgets. Keep a legal
  fallback if calculation runs out of budget; return no move for terminal boards.
- Add a JSON WebSocket `best_move` API, FEN/history replay, request correlation,
  typed `BotEngine`/`NativeBotAdapter`, timeouts, bounded worker admission and errors.
- Add bot seats and a database constraint separating human users from bots.
  Persist bot moves through the existing SAN, move-history, clock and result code.
  Check the chosen move and resulting FEN again through the rules service.
- Prevent human moves and duplicate calculations while the bot holds a PostgreSQL
  game-row lock, using NOWAIT across backend replicas. Preserve the committed
  human move on bot failure; allow an authorized participant to retry only the
  bot turn after failure/restart.
- Add bot-game creation, player-move and retry endpoints. Creation returns the
  durable ID; for a bot playing White, request its first turn with `bot-move`.
- Wire the app and test Compose stacks, and document protocol, migration,
  recovery behavior, difficulty limits and issue coverage in `srcs/bot/README.md`.

Stockfish-specific ticket names are implemented with the custom bot as requested;
this PR does not install or depend on Stockfish. Search strength is not Elo-rated.

## Validation

Passed here:

- 112 C++ bot checks covering all three difficulties, tactics (including forced
  mate in two), legal special moves, pins/check, terminal states and budget fallback.
- The same checks with AddressSanitizer/UndefinedBehaviorSanitizer; leak detection
  disabled due to the sandbox restriction.
- Real bot/rules WebSocket integration and compiled NestJS adapter tests.
- NestJS build, lint and 194 backend unit tests across 18 files.
- Compose YAML parsing and `git diff --check`.

Added real PostgreSQL integration tests for durable moves/replay, seat constraints,
service restart, NOWAIT conflicts and failure/retry. **Docker builds and the
PostgreSQL integration/HTTP stack were not run in this environment.** Run
`make test` and build/start Compose before merging. Detailed evidence is in
`srcs/bot/VALIDATION.md`.

## Migration and API notes

Apply `AddBotSeats1792278000000`. Existing human seats are preserved; rollback
refuses to discard bot history. Bot player IDs are seat UUIDs with
`botDifficulty` and `elo:null`; human player IDs retain their meaning.

After a bot error following a player move, GET the game and retry
`POST /v1/games/:id/bot-move`; the player's move may already be committed. Bot
search consumes its own clock. Authentication uses the existing server-populated
`request.user` boundary; the daemon stays internal to the Docker network.

## Tickets

Implements SCRUM-287/BOT-01, SCRUM-288/BOT-02, SCRUM-289/BOT-03,
SCRUM-290/BOT-04, SCRUM-291/BOT-05, SCRUM-292/BOT-06, SCRUM-293/BOT-07,
SCRUM-294/BOT-08, SCRUM-295/BOT-09, SCRUM-296/BOT-10, SCRUM-299/BOT-13,
SCRUM-301/BOT-15 and SCRUM-302/BOT-16 using the native engine replacement.
