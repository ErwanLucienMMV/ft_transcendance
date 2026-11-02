# SCRUM-493 · WebSocket payload bounds

Reviewed 2 November 2026 against `dev_test` at `062aaa6`.

The gateway already uses a 16,384-byte incoming message limit with compression
disabled and rejects binary data. Existing tests cover an oversized frame and
binary close codes. This branch reuses fragmented/multibyte case designs from
`c580ebc` (original branch retained) and adds a positive exact-boundary check.

- A fragmented message with 18,000 assembled bytes closes with 1009 before
  authentication or domain dispatch.
- 5,000 light-bulb emoji occupy 20,000 UTF-8 bytes and are rejected before
  authentication/dispatch, despite a smaller JavaScript string length.
- An authenticated, valid JSON envelope containing exactly 16,384 bytes is
  accepted and the connection stays open. The fixture handler acknowledges it;
  production event-specific domain validation still applies separately.

Validation: the actual-socket gateway suite passed **23 tests**, including the
three added cases. Expected injected transport warnings and the existing Vite
path-plugin notice remain. The production bound, domain contracts, tests and CI
were preserved; no package or external production dependency was introduced.

Reproduce from `srcs/nestJS/42chess`:

```sh
npm test -- src/realtime/realtime.gateway.spec.ts
```

Sources: [gateway](../srcs/nestJS/42chess/src/realtime/realtime.gateway.ts),
[tests](../srcs/nestJS/42chess/src/realtime/realtime.gateway.spec.ts).
