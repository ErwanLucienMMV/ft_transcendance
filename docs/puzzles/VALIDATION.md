# Validation — 2026-10-21

Base: `origin/feat/puzzle` at `7a7dab6` (merged bot implementation). No frontend or C++ source changes.

## Executed locally

Runtime: Node 24.19.0, PostgreSQL 15.19 in a temporary local cluster, and the real project `chess_engine`/`chess_bot` daemons. Local services and test processes shared an isolated network namespace. The Docker test stack targets Node 22 and PostgreSQL 15.

| Check | Result |
| --- | --- |
| `npm run build` | Pass |
| `npm run lint` | Pass |
| `npm run test:contracts` | Pass |
| `npm run test:all`: unit | 255 passed, 26 files |
| `npm run test:all`: database | 235 passed, 17 files |
| `npm run test:all`: HTTP | 93 passed, 8 files |
| Native bot-adapter transport smoke | Pass against both real daemons |
| `npm run test:puzzles` | 18 unit, 24 database, 14 HTTP tests passed |
| Compiled import CLI, default catalogue | 128 imported, 0 skipped |
| Compiled import CLI, second invocation | 0 imported, 128 skipped |
| Formatting of changed TypeScript/JSON/YAML | Pass |
| `git diff --check` | Pass |
| CI and test Compose YAML parsing | Pass |
| `make -n test-puzzles` | Correct container command and exit-status propagation |

The focused unit count includes four existing presenter tests; this feature adds 52 tests overall (14 unit, 24 database and 14 HTTP).

Coverage includes Lichess setup normalization and all 128 real variations, quoted CSV fields, malformed/illegal/missing input, bounded and repeated imports, source provenance, empty/legacy catalogues, concurrent daily selection, UTC date with a non-UTC database session timezone, rotation and stable assignments after imports, reversible schema changes, both solving colors, promotion/castling/en passant, alternate mate-in-one, wrong/illegal retries, automatic replies, completion, durable resume, CAS races, authorization and identity forgery, strict move DTOs, rules outages and absence of transactions during engine calls.

An initial local run against PostgreSQL 16 failed the existing test that explicitly requires PostgreSQL 15. Final runs use PostgreSQL 15; no version assertion was weakened.

## Docker and GitHub Actions

Docker is not installed in this implementation environment, so no container build/run or remote GitHub Actions execution is claimed. The tests are wired into the existing Docker test image and Vitest discovery. Run these from the repository root:

```sh
make test-puzzles
make test
```

The workflow still uses `make test` and additionally runs on direct pushes to `feat/puzzle`. No test-time puzzle download is needed: both CSV snapshots are included in the backend build context.
