# Chess puzzle backend

Implements SCRUM-303/304/305/306/309/310/453/479 (PUZZLE-01/02/03/04/07/08, TEST-12, E2E-14). This feature adds NestJS REST endpoints and persistence; the existing C++ WebSocket rules daemon remains the authority for chess legality.

## Start with Docker

From the repository root:

```sh
make
# NestJS applies migrations on startup. Import once after the services are ready:
docker compose -f srcs/docker-compose.yml exec -T nestjs npm run puzzle:import
```

The default import loads the bundled 128-puzzle Lichess starter catalogue. It validates every setup move and continuation using `CHESS_ENGINE_URL`. Repeating the import skips existing source IDs and preserves puzzles, daily assignments and attempts. No online puzzle API is contacted while serving players.

An empty catalogue returns `503 PUZZLE_CATALOG_EMPTY` until an import succeeds. Existing legacy puzzle rows are preserved, but are not enabled automatically: legality and provenance must be established before marking them validated. A failed import reports its line number and exits nonzero; previous valid rows remain committed, so the same command can be safely restarted. There is no public import HTTP endpoint.

For a larger catalogue, download the CC0 CSV from https://database.lichess.org/#puzzles, decompress it, and provide the CSV path and maximum records to examine. The importer streams rows and defaults to 1,000 records, with an explicit maximum of 100,000 per run. Limits count both imported and skipped rows. Increase the limit to read past a previously imported prefix.

```sh
# Copy your decompressed CSV into the running backend container:
docker compose -f srcs/docker-compose.yml cp ./lichess_db_puzzle.csv nestjs:/tmp/puzzles.csv
docker compose -f srcs/docker-compose.yml exec -T nestjs npm run puzzle:import -- /tmp/puzzles.csv 10000
```

Only the supported public theme enum is projected. Every original Lichess tag is retained in `sourceThemes`; game URL, source ID and rating are retained too. Imported `solutionMoves` metadata stays NULL because the CSV does not supply move timestamps or internal user IDs. No fictitious move authors are generated.

## REST API

All routes use the existing API error envelope `{statusCode, code, message}`. Authenticated routes verify an HS256 bearer access token issued by the authentication service, including signature, expiry and its persisted, non-revoked session. The shared guard accepts `typ=access`; legacy stateless tokens, a raw UUID, client-supplied user ID or 2FA challenge are not authentication. Logout revokes access to puzzle creation, resume and moves for that session without deleting progress or invalidating another session. See the [auth/puzzle integration report](../review-fixes-2026-10-26.md).

| Method | Route | Authentication | Result |
| --- | --- | --- | --- |
| GET | `/v1/puzzles/daily` | Public | `{id, date, fen, rating, themes}` |
| POST | `/v1/puzzles/:id/attempts` | Bearer | New independent attempt |
| GET | `/v1/puzzles/attempts/:id` | Bearer, owner | Resume persisted attempt |
| POST | `/v1/puzzles/attempts/:id/moves` | Bearer, owner | Validate move and apply automatic reply |

Start response and resumed state:

```json
{
  "attemptId": "<uuid>",
  "puzzleId": "<uuid>",
  "fen": "<current FEN>",
  "ply": 0,
  "version": 0,
  "completed": false,
  "attempts": 0,
  "duration": 0
}
```

Submit a UCI move, including a lower-case promotion suffix when applicable:

```json
{"move": "a2e6", "version": 0}
```

The answer includes the updated state plus `correct`, `completed`, `nextPosition`, and (when played) `opponentMove`. `fen` and `nextPosition` describe the board **after** the automatic reply. Only that already-played reply is returned; future moves and either solution representation are never exposed. The daily FEN already includes the Lichess setup move, so the player must not replay it.

A legal move outside the stored solution is incorrect. An illegal move is also incorrect. Both leave the board and accepted plies unchanged, increment `attempts` and `version`, and allow retry. Mate-in-one puzzles additionally accept any legal move that actually checkmates, as specified by Lichess. Other variations are validated against the imported main line; this backend does not evaluate alternative winning lines.

Every correct move applies the next opponent move atomically with progress persistence. Completion occurs when the last solver move is accepted. `ply` counts accepted half-moves, including replies. `attempts` counts submissions, including correct and incorrect tries; `duration` is elapsed wall time in milliseconds from attempt creation to the last submission, capped at PostgreSQL's integer maximum. Reloading does not reset either metric. A new attempt resets progress; completed attempts remain immutable.

Send the returned `version` with every subsequent move, even after an incorrect submission. Duplicate or concurrent submissions from the same version receive `409 PUZZLE_STALE_VERSION`; reload the attempt before continuing. Another user's attempt returns 404. Completed attempts return `409 PUZZLE_ALREADY_COMPLETED`. Old attempts without a resumable FEN return `409 LEGACY_PUZZLE_ATTEMPT` and require starting a new attempt.

## Daily selection and concurrency

The first request for a UTC calendar date selects a puzzle, and PostgreSQL persists that assignment under the existing unique date constraint. A transaction-scoped advisory lock serializes concurrent selectors across API replicas. PostgreSQL supplies the UTC date, independent of the API or database session timezone. Selection prefers never-used puzzles and then the least recently used, with UUID as a stable tie-breaker. Importing more puzzles or restarting NestJS never changes an existing daily assignment. Unrequested dates need no scheduled job or backfill; the next request selects for the current date. An in-progress attempt remains playable after midnight.

Gameplay performs external rules calls before an optimistic compare-and-swap update. No transaction, row lock or database connection is held during those calls. Rules outages return `503 PUZZLE_ENGINE_UNAVAILABLE` and preserve progress and counters. The client never supplies FEN, solution, result, duration or identity.

Migration `AddPuzzleTraining1792600000000` adds provenance/validation fields to puzzles and `currentFen`/`version` to attempts. It is reversible and leaves existing rows intact. As with other down migrations, rolling it back removes its new metadata; a restored catalogue then requires revalidation/reimport. It never fabricates missing legacy metadata.

## Tests

```sh
# Focused unit + PostgreSQL + real HTTP puzzle tests, entirely inside Docker:
make test-puzzles
# Full repository test target used by GitHub Actions:
make test
```

`npm run test:all` automatically includes the new unit, database and HTTP suites through the existing Vitest discovery rules. The test container receives both CSV files via the backend source COPY. PostgreSQL and the rules daemon run in separate containers; integration and HTTP tests use real SQL migrations, UCI legality and verified JWTs. No internet download is required for tests. CI also runs on direct pushes to `feat/puzzle` and on the existing PR targets.

See [VALIDATION.md](VALIDATION.md) for executed checks and [PR.md](PR.md) for the proposed PR description.
