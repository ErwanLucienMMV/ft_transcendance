# Server/client game clock synchronization ? SCRUM-174 (CLOCK-08)

The persisted PostgreSQL clock remains authoritative. Existing game lifecycle, increments,
timeouts, waiting seats, resignation and reconnection are reused. There is no application
pause/resume command; no new pause state is introduced.

`GAME_STATE` and `CLOCK_UPDATE` add `serverTime` (ISO-8601 UTC of the persisted clock
checkpoint, not packet emission) and `clockStatus` (`WAITING`, `RUNNING`, `STOPPED`,
`EXPIRED`). Clock values and durations are milliseconds. The fields are additive.

After joining a room, a seated client can send `SYNC_CLOCK` with `{gameId, requestId}`.
The request identifier must be a non-negative safe integer. Room authorization and the
existing per-game serialization apply. The unicast `CLOCK_SYNC` echoes that identifier
and returns `clocks`, `turn`, `status`, `clockStatus`, `serverTime`, `processingMs` and
`sampleAgeMs`. Processing uses a server monotonic timer, never client time. The normal
durable settlement service applies a timeout if one occurred; the client cannot set time.

Angular `GameRealtime.displayClocks` projects only the active color from the latest server
sample. `game().clocks` retains the authoritative sample. A monotonic round-trip sample
estimates one-way network delay as half of RTT minus server processing. This is an
estimate under asymmetric network latency, not a guarantee of exact transit time.
Samples over 10 seconds old and malformed/older checkpoints are rejected. Synchronization
is refreshed at most every 10 seconds when updates arrive, and on a fresh reconnect.
The display never applies increments itself, never declares a timeout/result, clamps at
zero, and freezes stopped/expired/finished samples. Disconnect discards the prior time
base; reconnection restores a full server snapshot before projecting again.

## Validation

From `srcs/nestJS/42chess`, with the existing test PostgreSQL/C++ services:

- `npm run build`
- `npm exec vitest -- run src/games/clock src/realtime/game-realtime.service.spec.ts`
- `npm exec vitest -- run --config vitest.config.e2e.ts test/game-realtime.e2e-spec.ts`

From `srcs/angular/42chess`:

- `npm test -- --watch=false --include="src/app/core/realtime/*.spec.ts"`
- `npm run build`

Tests cover network delay/processing, turn/increment reanchoring, malformed/stale samples,
terminal freeze, client account/reconnection isolation, real WebSocket/PostgreSQL resync,
resignation and the existing real timeout lifecycle.

## Audited base and results

Base: `db4787ed3adc1ee470a09801b9a0c3981d36d114` (`origin/dev_test`).
Examined SCRUM-174/CLOCK-08: persisted PostgreSQL clocks, settlement/timeout worker,
realtime join/tick/end lifecycle, Angular room replay and account isolation. Existing
server clocks were already durable; the missing pieces were client monotonic projection
and latency sampling. The old tick timestamp described emission rather than its sample.

Validation in the existing Linux Node 22 Docker images (Windows native dependencies
lacked the optional rolldown binding):

- Backend build: PASS.
- Clock + realtime unit tests: 3 files, 73 tests passed.
- Real game WebSocket E2E with isolated PostgreSQL port 55436 and existing chess/bot
  test services: 1 file, 12 tests passed, including reconnect/resign sync and real timeout.
- Angular realtime tests: 3 files, 29 tests passed.
- Angular production/SSR build: PASS, 3 static routes prerendered.

No migration, private environment file, presence service, gateway, root module or CI
workflow was changed. Clients without the new metadata retain authoritative snapshots;
they cannot perform latency projection until the new server contract is available.
