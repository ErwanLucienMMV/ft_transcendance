# Validation of feat/bot

## PR-review follow-up (2026-10-20)

Continues `d7d0cdc` on `feat/bot`; no engine or bot search implementation was
replaced. The current follow-up changes backend turn coordination, API behavior,
formatting and the test wiring.

Executed successfully for this follow-up:

- NestJS `npm run build`.
- **204 backend unit tests across 20 files**, including bot calculation/rules
  calls with no active transaction, duplicate coalescing, abandoned-lease reclaim,
  stale position/result rejection, failure responses, automatic White openings,
  active-game limits, bot draw rejection and public pending/thinking indicators.
  Transaction-double tests check orchestration, not actual PostgreSQL behavior.
- **12 HTTP e2e contract tests** for the real compiled bot controller, guard,
  DTO validation and error/status mapping (`npm run test:bot-http`). Domain and
  repository providers are replaced in that isolated HTTP contract suite.
- Live `npm run test:bot-adapter` against the actual C++ bot and rules daemons:
  all three difficulties, legal moves, matching resulting FENs, malformed FEN,
  terminal positions and disconnect behavior.
- The same adapter smoke test in **external-endpoint mode**, relocated outside
  the repository with `NEST_DIST_DIR` overridden, validating the Docker test
  image's layout and use of the running bot/rules services.
- `npm run lint`, backend Prettier checks and `git diff --check`.
- Docker test Compose context and all changed `COPY` source paths resolve.

Added/updated real PostgreSQL tests in `test/bot-games.integration-spec.ts` for:

- Durable legal replies, SAN/replay and restart behavior for all difficulties.
- Automatic bot opening and successful pending responses after an outage.
- Lock-free stalled search: another connection acquires the same game row with
  `FOR UPDATE NOWAIT`, and unrelated SQL remains available while calculation waits.
- Duplicate jobs, resignation during calculation, expired reservations and one
  saved reply after concurrent retry.
- Concurrent account creation limits, draw rejection and human/bot-seat checks.

Those PostgreSQL tests and full Docker image/stack execution **could not run in
this sandbox**: Docker is unavailable and the environment has no non-root
PostgreSQL runtime. They are included in root `make test` and must pass on the
Docker-capable checkout before merge. The reviewer's previous full run applies
to the earlier revision, not automatically to these new changes.

## Existing C++ validation

The unchanged C++ implementation previously passed **112 bot checks**, including
all difficulties, legal special moves/check evasions, mates in one, a forced mate
in two, deterministic search, deadlines and fallback behavior. The real bot/rules
transport suite also previously passed. The live adapter checks above exercise
the same unchanged daemons again in this follow-up.

AddressSanitizer/UndefinedBehaviorSanitizer passed the initial 112 checks with
`ASAN_OPTIONS=detect_leaks=0`; no new sanitizer run or leak-check claim is made
for this backend-only follow-up. No Elo rating has been measured.

## Test entry points

- `make test-bot`: C++ and real-daemon transport checks inside the bot Docker test stage.
- Root `make test`: the above, then backend unit/PostgreSQL/HTTP tests and the
  compiled NestJS adapter smoke test. `test:all` explicitly includes that script.
- `npm run test:bot-http`: isolated controller HTTP contract without PostgreSQL.
- See README.md for configuration, migration, retry and lease semantics.
