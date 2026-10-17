# Validation of feat/bot

Based on `origin/feat/bot` at `779e654418b5c7a130a23d6780747d40061845df`.
That branch already contains the updated engine and persisted game lifecycle.
No old engine ZIP or old checkout was substituted for current repository files.

Executed successfully in the implementation environment:

- GCC 13.3 build of the bot and current rules daemon, C++17, warnings as errors.
- **112 C++ bot checks**, covering EASY/MEDIUM/HARD, legal moves in special-move
  and pinned/check positions, hanging-queen captures, mates in one, a forced
  mate in two verified against every defense, terminal positions, history replay,
  deterministic search, budget fallback and JSON validation.
- The same **112 checks under AddressSanitizer and UndefinedBehaviorSanitizer**.
  Leak detection was disabled (`ASAN_OPTIONS=detect_leaks=0`) because the sandbox
  cannot support LeakSanitizer process inspection. No leak-check result is claimed.
- Real bot + rules WebSocket integration: all difficulties return legal moves
  and matching resulting FENs according to the separate rules daemon. Also tests
  malformed JSON recovery, fragmentation, concurrent clients, mate, terminal
  positions, binary/oversized messages and SIGTERM.
- Live compiled NestJS `NativeBotAdapter` against both real daemons: all three
  profiles, FEN replay, chosen-move validation, invalid input, terminal/null moves
  and daemon disconnect handling.
- NestJS `npm run build` succeeds.
- Backend `npm test`: **194 tests across 18 files pass**, including eight new
  orchestration tests with transaction doubles (persistence flow, retry,
  stale/illegal/FEN mismatch rejection, lock conflict, actor checks and timeout).
- Backend `npm run lint` succeeds.
- All three edited Compose files parse as YAML and contain their bot service.
- `git diff --check` succeeds.

Example opening measurement (e2e4 e7e5; informational, not a benchmark promise):

| Difficulty | Selected move | Completed depth | Nodes | Search time |
| --- | --- | ---: | ---: | ---: |
| EASY | b1c3 | 1 | 60 | <1 ms |
| MEDIUM | b1c3 | 3 | 1791 | 21 ms |
| HARD | b1c3 | 4 | 100000 | 1236 ms |

Not executed here:

- Docker image builds/full Compose startup (Docker is unavailable).
- PostgreSQL integration/HTTP test stack. The sandbox only maps root and cannot
  run PostgreSQL as a non-root account. The new real-database tests are included
  in `test/bot-games.integration-spec.ts` and wired into the existing `make test`
  Docker stack with PostgreSQL 15 and both real C++ services. Their results are
  **not** represented by the passing transaction-double unit tests.

Before merging, run `make test` and build/start Compose in a Docker-capable
checkout. See README.md for all reproduction commands, migration and API notes.
No Elo rating or claim of defeating a particular player strength was measured.
