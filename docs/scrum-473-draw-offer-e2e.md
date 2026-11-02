# SCRUM-473 · Draw-offer E2E verification

Reviewed 2 November 2026 against `dev_test` at `062aaa6`.

The existing actual-WebSocket acceptance suite already offers, declines and
accepts a draw with matching terminal events to both players. It preserves
move history when subsequent mutation is refused and restores pending offers
after reconnect.

This branch adds two end-to-end flows. A player accepting their own offer gets
OWN_DRAW_OFFER, leaving the offer available to the opponent; opponent acceptance
then survives reconnect as FINISHED/DRAW_AGREEMENT with two original seats and
no moves. Separately, a legal move clears an outstanding offer; stale acceptance
gets DRAW_NOT_OFFERED while the game stays active with exactly the committed move.

Validation: backend build passed; `vitest run --config vitest.config.e2e.ts
test/game-realtime.e2e-spec.ts` passed **17 tests** with dedicated PostgreSQL
and real C++ rules/bot fixtures. Authentication is substituted only inside the
existing test module; this does not claim live OAuth or browser rendering was
tested. The existing Vite path-plugin notice remains. No production behavior
or existing assertion was changed.

Sources: [acceptance suite](../srcs/nestJS/42chess/test/game-realtime.e2e-spec.ts),
[agreement integration](../srcs/nestJS/42chess/test/game-agreement.integration-spec.ts).
