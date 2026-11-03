# SCRUM-489 · Finished-game mutation protection

Reviewed 2 November 2026 on `dev_test` at `062aaa6`.

The domain layer already rejects mutations after a terminal result, independent
of the REST/WebSocket caller. No production change was necessary.

`test/game-agreement.integration-spec.ts` checks offerDraw, acceptDraw,
declineDraw and resign against finished games. Each returns
GAME_ALREADY_FINISHED and the persisted state remains equal to the completed
snapshot. Moves after resignation are rejected. Concurrent accept-versus-resign
settles exactly one result; the other operation fails. Database constraints
also prevent retaining an active draw offer on a finished game.

`test/game-realtime.e2e-spec.ts` exercises an accepted draw over actual sockets,
then rejects another move while preserving an empty move history. Resignation
reconnect restores the terminal result, and clock synchronization checks stopped
clocks. `test/game-api.e2e-spec.ts` reads a finished result twice and asserts
identical responses. Rating lifecycle integration verifies one durable settlement.

Validation: **408 database integration tests in 28 files** and **362 acceptance
tests in 41 files** passed on the identical production source `062aaa6` in the
sibling OAuth verification worktree. Backend build and TypeScript contracts
passed. Dedicated test PostgreSQL/rules/bot fixtures were used. Expected injected
outage logs and the existing Vite path-plugin notice remain.

Reproduce from `srcs/nestJS/42chess` with isolated fixtures running:

```sh
npm run build
./node_modules/.bin/vitest run --config vitest.config.database.ts test/game-agreement.integration-spec.ts test/game-lifecycle.integration-spec.ts test/rating-lifecycle.integration-spec.ts
./node_modules/.bin/vitest run --config vitest.config.e2e.ts test/game-api.e2e-spec.ts test/game-realtime.e2e-spec.ts
```

Read-only history and reconnection remain supported after completion. No
completed game is reopened, no rating is accepted from the client, and this
verification does not require changing test or CI enforcement.

Sources: [agreement tests](../srcs/nestJS/42chess/test/game-agreement.integration-spec.ts),
[lifecycle tests](../srcs/nestJS/42chess/test/game-lifecycle.integration-spec.ts),
[realtime tests](../srcs/nestJS/42chess/test/game-realtime.e2e-spec.ts).
