# SCRUM-490 · Puzzle solution exposure verification

Reviewed 2 November 2026 on `dev_test` at `062aaa6`.

The puzzle API already keeps future solution moves server-side. No production
change is necessary; this ticket records the existing acceptance evidence.

`test/puzzles.e2e-spec.ts` checks eight concurrent anonymous daily reads against
an exact field allowlist: date, fen, id, rating and themes. The response has
Cache-Control: no-store and no solution, sourceId, moves or playerId fields.

The play-through test reads the solution only through the test database fixture,
then submits each player move to the public API. Every response is checked for
absence of solution and moves fields, including completion. The current FEN and
nextPosition agree. The suite also checks real bearer verification, forged
identity claims, session revocation, another user's attempt isolation, invalid
input, stale-version refusal and recovery after an empty catalogue.

The player's accepted move, completed progress and immediate automatic opponent
reply are intentionally public to that attempt's owner. They are necessary to
render play and are distinct from disclosing the future solution. Public daily
metadata deliberately includes the starting position.

Validation: the baseline acceptance run passed **362 tests in 41 files** and
database integration passed **408 tests in 28 files**, including puzzle suites.
They used identical production source `062aaa6` in the sibling OAuth verification
worktree with dedicated PostgreSQL and real C++ rules fixtures. Backend build
and public TypeScript contracts passed. Expected injected-failure logs and the
existing Vite path-plugin notice remain visible.

Reproduce from `srcs/nestJS/42chess` with isolated fixtures running:

```sh
npm run build
./node_modules/.bin/vitest run --config vitest.config.e2e.ts test/puzzles.e2e-spec.ts
./node_modules/.bin/vitest run --config vitest.config.database.ts test/puzzles.integration-spec.ts
```

This verifies response contracts and access checks in the repository. It does
not inspect live user attempts or claim that deployed logs/backups were audited.
No puzzle source data, solution or coverage was removed.

Sources: [controller](../srcs/nestJS/42chess/src/puzzles/puzzles.controller.ts),
[acceptance tests](../srcs/nestJS/42chess/test/puzzles.e2e-spec.ts),
[integration tests](../srcs/nestJS/42chess/test/puzzles.integration-spec.ts).
