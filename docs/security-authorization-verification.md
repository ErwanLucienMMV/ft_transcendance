# Security authorization and input verification — 31 October 2026

Reference: `origin/dev_test` at `b49b735`. Jira descriptions for SEC-01–09,
SEC-11 and SEC-12 contain only epic and ticket labels. Expectations therefore
come from the existing public contracts, service invariants and specification.

The controls below already exist. This branch adds 129 regression cases
(124 DTO/domain cases and five actual-socket cases) and records execution of
the existing acceptance and database suites. It changes no production behavior.

| Jira task                                                                    | Control and executable evidence                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [SCRUM-482 / SEC-01](https://42transcendance.atlassian.net/browse/SCRUM-482) | `PasswordService` uses salted Argon2id. `password.service.spec.ts` checks algorithm, distinct salts, correct/incorrect passwords and malformed hashes.                                                                                                                                                                                                                                                                   |
| [SCRUM-483 / SEC-02](https://42transcendance.atlassian.net/browse/SCRUM-483) | The global `ValidationPipe` rejects unknown fields and validates nested DTOs. New `dto-security.spec.ts` covers all 16 exported DTO classes, valid input, invalid types/bounds, nested injection and server-owned properties. `BotGameMoveDto` checks presence; the controller calls `moveInput()` to reject malformed UCI before the game service. OAuth callback queries are manually type checked and flow validated. |
| [SCRUM-484 / SEC-03](https://42transcendance.atlassian.net/browse/SCRUM-484) | `game-api.e2e-spec.ts` rejects anonymous/forged creation identities; `game-realtime.e2e-spec.ts` rejects outsider and room-less mutations, spoofed actor fields and wrong-turn moves. Public game state/history intentionally remain readable for spectating.                                                                                                                                                            |
| [SCRUM-485 / SEC-04](https://42transcendance.atlassian.net/browse/SCRUM-485) | Private-message history/realtime/adversarial acceptance suites verify authenticated sender identity, participant-only history and delivery, outsider isolation and revoked sessions. Database cases verify both conversation directions and unread counts are actor-scoped.                                                                                                                                              |
| [SCRUM-486 / SEC-05](https://42transcendance.atlassian.net/browse/SCRUM-486) | Friends send/accept/management acceptance tests verify authentication, recipient-only acceptance/rejection, forged actor rejection, outsider isolation and rollback after persistence failure.                                                                                                                                                                                                                           |
| [SCRUM-487 / SEC-06](https://42transcendance.atlassian.net/browse/SCRUM-487) | Actual WebSocket spectators cannot move, resign, offer or accept draws. Unit routing cases also cover decline and a seated player explicitly choosing spectator mode.                                                                                                                                                                                                                                                    |
| [SCRUM-488 / SEC-07](https://42transcendance.atlassian.net/browse/SCRUM-488) | Profile and preference acceptance suites reject client Elo fields; the new matrix rejects Elo across every DTO and inside nested objects. Rating lifecycle integration tests verify server-side updates and idempotent terminal settlement.                                                                                                                                                                              |
| [SCRUM-489 / SEC-08](https://42transcendance.atlassian.net/browse/SCRUM-489) | Game lifecycle/agreement integration and actual WebSocket tests reject moves after a terminal result and preserve history. Resignation/reconnect restores the durable terminal state and stopped clocks.                                                                                                                                                                                                                 |
| [SCRUM-490 / SEC-09](https://42transcendance.atlassian.net/browse/SCRUM-490) | `puzzles.e2e-spec.ts` asserts exact solution-free daily fields, no future solution/move arrays during play, no access to another account's attempts, and rejection of forged progress. Completed moves and the immediate opponent reply are intentionally returned during play.                                                                                                                                          |
| [SCRUM-492 / SEC-11](https://42transcendance.atlassian.net/browse/SCRUM-492) | Gateway limits each connection to 60 messages per 10 seconds (including authentication) and 32 queued commands. New actual-socket cases independently exhaust the rate budget with sequential completed commands and the queue budget with validation pending; a separate connection remains usable.                                                                                                                     |
| [SCRUM-493 / SEC-12](https://42transcendance.atlassian.net/browse/SCRUM-493) | Gateway `maxPayload` is 16,384 bytes with compression disabled. Existing oversized-frame and binary tests are retained. New cases verify assembled fragmented messages and UTF-8 byte size, before authentication or dispatch.                                                                                                                                                                                           |

## Validation

- NestJS build and public TypeScript contracts passed.
- Complete backend unit suite: **665 passed**, 45 files.
- Complete PostgreSQL integration suite: **408 passed**, 28 files.
- Complete HTTP/WebSocket acceptance suite: **344 passed**, 40 files.
- Corrected nested-input test matrix rerun separately: **124 passed**.
- Lint of both changed TypeScript files: no errors, 14 unbound-method warnings
  in the gateway test file. Formatting and `git diff --check` passed.

The dedicated PostgreSQL, bot and chess-engine fixtures were used. Engine image
builds also passed their existing C++ rules/protocol and WebSocket checks. The
host compiler lacked Boost headers; no system dependencies were changed.
An initial sandboxed socket run failed with `listen EPERM`; the subsequent
complete unit run with local socket access passed. Vite reports its existing
TypeScript path-plugin notice. The acceptance configuration contains an existing
duplicate `hookTimeout` key; no warning about it appeared in this run.
Observe telemetry logged a rate-limit response (429), without failing tests.
Injected database/engine outages produce expected error logs while the
corresponding rollback tests pass. The additional rate-window recovery case
verifies the same socket can keep sending after its ten-second budget renews.

From `srcs/nestJS/42chess`, with the dedicated fixtures running:

```sh
npm run build
npm run test:contracts
npm test
npm run test:db
npm run test:e2e
./node_modules/.bin/oxlint --type-aware src/common/dto-security.spec.ts src/realtime/realtime.gateway.spec.ts
./node_modules/.bin/prettier --check src/common/dto-security.spec.ts src/realtime/realtime.gateway.spec.ts ../../../docs/security-authorization-verification.md
git diff --check
```

This verification is separate from the HTTP limiter (SCRUM-491), deployment
secrets (SCRUM-494) and OAuth configuration (SCRUM-495) branches. Existing
messaging recipient-race/lifecycle branches remain preserved and unmerged.
No Jira status, comment, pull request or production data was changed.
