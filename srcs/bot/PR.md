# feat(bot): native chess opponent, WebSocket service and safe persisted bot turns

Source: `feat/bot`. Target: `dev_test`.

Add a custom C++ chess bot with EASY/MEDIUM/HARD profiles, using the existing rules
implementation for all legal moves. Expose bounded JSON WebSocket search in its
own Docker service; connect it through NestJS's typed `BotEngine` adapter.
Stockfish is not a dependency. Rename BOT-01 in the tracker to **Compiler et
installer le bot maison**; local docs use that replacement title.

## Game lifecycle

- Persist explicit bot seats and save replies through the normal SAN, ply,
  clock, FEN and terminal-result path. Revalidate replies with the rules daemon.
- Reserve the turn in a short transaction, compute **and validate outside all
  transactions**, then lock again and check the lease/token, position/history,
  status and seat before saving. No pool connection is held during search.
- Coalesce concurrent retries, reclaim expired reservations, discard stale/late
  results and allow resignation/clock expiry while the bot is working.
- Return the accepted human move normally when bot search fails, with public
  `botPending`, `botThinking` and `botError` fields. Retry only the bot turn.
- Play White's first move automatically when the human chooses Black, returning
  a durable game ID and pending state even if the opening request fails.
- Limit each account to one ACTIVE bot game, under an account row lock, and
  reject draw offers to bots without storing them.

## Build, integration and coordination

C++ uses tabs, declarations in `.hpp`, and split implementations. TypeScript
follows the backend's existing Prettier configuration (spaces), including shared
files. The Makefile supports incremental objects, dependencies and native/Docker
test targets. `make test` includes C++ tests, real-daemon WebSocket tests, backend
unit/database/HTTP tests and `nest_adapter_test.mjs`.

The PR description now lives at `srcs/bot/PR.md`, not repository root. The game
fixture includes Erwan's #48 TRUNCATE table list, scoped to the isolated schema
and tables present on the branch so it also works before that database PR lands.
Realtime consumers must broadcast **every newly stored ply** (a player request
can add two moves); #53's handler correction remains with its owner. Bot seats
are explicit for the rating PR's exclusion; that owner's ELO changes are not
reimplemented here.

## Migration and validation

Apply `AddBotSeats1792278000000` and `AddBotTurnLease1792500000000`. Existing human
rows remain valid; no account is created for bots. Public bot IDs are seat UUIDs,
with `botDifficulty` and `elo:null`. Lease details stay private.

See `VALIDATION.md` for exact checks run and environment limits. The new tests
cover search without a database lock, duplicate/stale/expired jobs, successful
pending replies, automatic White openings, concurrent creation limits, draw
rejection, and the bot controller's HTTP contract. Docker/PostgreSQL integration
must run in a Docker-capable environment before merge.

Implements SCRUM-287..296 / BOT-01..10, SCRUM-299/BOT-13,
SCRUM-301/BOT-15 and SCRUM-302/BOT-16 with the custom engine replacement.
