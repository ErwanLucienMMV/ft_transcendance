# SCRUM-307 — Daily puzzle API audit

Base: `origin/dev_test` at `db4787ed3adc1ee470a09801b9a0c3981d36d114`.
Branch: `feat/daily-puzzle-api`.

## Existing implementation

SCRUM-307 / PUZZLE-05 was already implemented by merged PR #58. Its supplied
Jira status of To Do does not describe the current code. No replacement endpoint,
schema, scheduler, or puzzle selection service is needed.

The public route is `GET /v1/puzzles/daily`, following the existing versioned API
convention. It returns `{ id, date, fen, rating, themes }` without either solution
representation, user identity, or import metadata. Success and empty-catalogue
responses use `Cache-Control: no-store`.

PostgreSQL supplies the current UTC calendar date. A transaction-scoped advisory
lock and the unique date constraint keep selection consistent across API replicas.
Existing daily assignments survive imports and restarts. New days choose an unused
puzzle, then the least recently used, with UUID tie-breaking. Empty or entirely
unvalidated catalogues return `503 PUZZLE_CATALOG_EMPTY`.

Existing automated tests cover concurrent replicas, a non-UTC database timezone,
rotation, assignment stability after imports, response fields and anonymous access.
The date is determined when PostgreSQL executes the UTC clock query;
there is no client-supplied historical-date parameter or scheduled midnight job.
See [the API documentation](README.md#daily-selection-and-concurrency).

## Added regression coverage

- Fail the daily INSERT inside PostgreSQL, verify no assignment remains, then let
  two replicas retry. This exercises transaction rollback and advisory-lock release.
- Request the public endpoint with an empty catalogue, verify the HTTP error code
  and cache policy, import valid puzzles and verify successful recovery.
- Assert the cache policy on concurrent successful HTTP responses.

Production Puzzle, authentication, presence and metrics code is unchanged. There
are no migrations or dependencies on another worker's unpublished changes.

## Validation

Run from `srcs/nestJS/42chess` with the existing isolated PostgreSQL/C++ test stack:

```sh
npm run build
npx vitest run src/puzzles src/auth/access-token.guard.spec.ts
npx vitest run --config vitest.config.database.ts test/puzzles.integration-spec.ts
npx vitest run --config vitest.config.e2e.ts test/puzzles.e2e-spec.ts
```

The sprint validation uses the existing `pr61-api` Node 22 Linux image, its
dependencies in a Docker volume, a dedicated PostgreSQL 15 instance and an
isolated real rules daemon on the `sprint4-daily-net` Docker network. The host Node 20 runtime cannot
build the current Nest CLI, and the existing host dependencies lack a Windows
Rolldown native binding; no package manifest, lockfile or test was altered to
work around these environment limitations.

| Check | Result |
| --- | --- |
| Backend build | Pass |
| Puzzle and access-token unit tests | 20 passed, 3 files |
| Puzzle database integration | 25 passed, 1 file |
| Puzzle HTTP E2E | 16 passed, 1 file |
| TypeScript contract checks | Pass |
| Backend lint | Pass, 0 errors and 28 existing warnings |
| `git diff --check` | Pass |

Two earlier runs through `host.docker.internal` each had 24/25 integration tests
pass and one engine request time out; the failed case differed between runs.
Using direct Docker networking resolved this transport problem, including the
complete 128-puzzle import. No tests were skipped or weakened.
