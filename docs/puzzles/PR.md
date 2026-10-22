# feat(puzzles): implement daily puzzles and persisted solution progression

The puzzle module previously contained entities and projections but no playable backend. Add a public daily-puzzle endpoint and authenticated attempt/start/resume/move endpoints. Moves are checked through the existing C++ rules daemon; correct moves advance the stored line and automatically apply the opponent reply. Wrong moves preserve the board, mate-in-one alternatives are accepted when they actually checkmate, and future solution moves are never returned.

Persist one assignment per UTC date using a PostgreSQL advisory lock and the unique date constraint. Versioned updates prevent simultaneous requests from applying a turn twice. Persist accepted plies, submissions, completion and duration; rules outages leave all progress unchanged. Verify real bearer access tokens and scope every attempt to its owner.

Add a reversible migration, a streaming/idempotent Lichess CSV importer, and a bundled 128-puzzle CC0 starter catalogue. Imported setup moves and every solution ply are validated with the rules daemon. Keep provenance and original themes without inventing missing move-author metadata. Replace the rollback test's fixed migration count with the actual feature migration count.

Tickets: SCRUM-303, SCRUM-304, SCRUM-305, SCRUM-306, SCRUM-309, SCRUM-310, SCRUM-453, SCRUM-479.

## Validation

- Build, lint and compile-time contracts pass.
- Full backend suite: 255 unit, 235 PostgreSQL and 93 HTTP tests pass (583 total), plus the native bot-adapter smoke test.
- Focused puzzle command: 18 unit tests (including four existing presenter tests), 24 PostgreSQL integration tests and 14 HTTP tests pass.
- CLI import loads all 128 starter puzzles; a second import skips all 128.
- `make test-puzzles` runs focused tests in the existing Docker stack. `make test`/`npm run test:all` discover the new suites automatically. CI also triggers on pushes to `feat/puzzle`.

Tests were executed locally with PostgreSQL 15 and real C++ daemons. Docker is unavailable in the implementation environment; container execution and GitHub Actions results remain to be confirmed after pushing. See `docs/puzzles/VALIDATION.md`.

## Deployment

After migrations and service startup, run:

```sh
docker compose -f srcs/docker-compose.yml exec -T nestjs npm run puzzle:import
```

The daily route returns `503 PUZZLE_CATALOG_EMPTY` until validated puzzles are available. Existing puzzle and attempt rows are preserved; unvalidated legacy puzzles are not automatically enabled. See `docs/puzzles/README.md` for the API, import limits, error codes and upgrade behavior.
