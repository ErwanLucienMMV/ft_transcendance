# SCRUM-492 · WebSocket rate and queued-work bounds

Reviewed 2 November 2026 against `dev_test` at `062aaa6`.

The gateway already limits a connection to 60 messages per ten seconds,
including authentication, and 32 queued commands. This branch reuses the
targeted test designs from `c580ebc` and `0b1698c`, preserving both original
commits/branches, without changing the production limits.

New actual-socket cases distinguish completed sequential commands from queued
work: after authentication, 59 successful commands exhaust the rate budget;
the next receives TOO_MANY_REQUESTS and closes with 1013. Another connection
remains healthy. Advancing only the wall clock beyond ten seconds renews the
budget while retaining real IO and timers. Holding session validation pending
independently exhausts the work queue without dispatching a domain action.

Validation: the gateway suite passed **23 tests**, including the three added
cases, over actual local sockets. Vite reports its existing path-plugin notice;
injected internal/auth errors produce expected warning logs. No test was skipped
or weakened, and no production transport or CI setting changed.

Reproduce from `srcs/nestJS/42chess`:

```sh
npm test -- src/realtime/realtime.gateway.spec.ts
```

Sources: [gateway](../srcs/nestJS/42chess/src/realtime/realtime.gateway.ts),
[tests](../srcs/nestJS/42chess/src/realtime/realtime.gateway.spec.ts).
