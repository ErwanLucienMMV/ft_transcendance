# SCRUM-484 · Game authorization verification

Reviewed 2 November 2026 on `dev_test` at `062aaa6`.

The required authorization controls already exist. This ticket records their
verified behavior; no production change or test weakening is necessary.

| Boundary | Existing control and evidence |
| --- | --- |
| REST actor | `GameActorGuard` uses a verified server principal or authenticates the bearer session; client headers/body cannot populate request.user |
| Game creation | `test/game-api.e2e-spec.ts` rejects anonymous, forged and unverified bearer identities without inserting a game |
| Invitation | The same suite rejects an outsider joining a reserved second seat and preserves game state |
| Move author | `test/game-realtime.e2e-spec.ts` rejects wrong-turn moves, invalid moves and forged userId without changing history or broadcasting a move |
| Room access | Outsiders cannot JOIN_GAME; room-less RESIGN returns ROOM_REQUIRED without finishing the game |
| Spectators | The actual-socket spectator cases reject player commands while retaining observation access |

Public game state and move history are intentionally readable for live watching
and replay. Public read permission does not authorize changing seats, moves,
clocks, agreements or results. The domain service remains authoritative after
transport checks.

Validation: backend build and TypeScript contracts passed. The complete baseline
acceptance run passed **362 tests in 41 files**, including the suites above;
the baseline database run passed **408 tests in 28 files**. They ran on the same
production source `062aaa6`, in the OAuth verification worktree (whose only
addition was an OAuth unit test). Dedicated test PostgreSQL, C++ rules and bot
services were used; no application data was used. Injected failure tests log
expected errors. Vite prints its existing path-plugin notice.

Reproduce from `srcs/nestJS/42chess`, with dedicated test fixtures running:

```sh
npm run build
./node_modules/.bin/vitest run --config vitest.config.e2e.ts test/game-api.e2e-spec.ts test/game-realtime.e2e-spec.ts
```

The game transport fixture substitutes the authentication boundary; real JWT
verification is covered separately by auth/session acceptance suites. These
results do not imply that public reads should become private.

Sources: [guard](../srcs/nestJS/42chess/src/games/game-actor.guard.ts),
[game API tests](../srcs/nestJS/42chess/test/game-api.e2e-spec.ts),
[actual-socket tests](../srcs/nestJS/42chess/test/game-realtime.e2e-spec.ts).
