# Sprint 4 Friends management

Branch: `feat/friends-management`.
Base: `12448f04e177d72d92097e670738cb73007e9841` on the explicitly published
`feat/sprint4-foundation-preserved` dependency. Integration target: `dev_test`.
The dependency preserves the existing published Sprint 4 list/send/accept work and
the sessions/presence already integrated in `dev_test` (`db4787e`).

## Ticket audit and scope

The user's Jira CSV supplies the mission statuses; a To Do status does not imply
missing implementation. No Jira status was changed by this branch.

| Ticket | Finding and disposition |
| --- | --- |
| SCRUM-228 FRIEND-01 | Existing public-only accepted friends list retained and retested. |
| SCRUM-229 FRIEND-02 | Existing authenticated request creation retained and retested. |
| SCRUM-230 FRIEND-03 | Existing self-request rejection, including uppercase UUIDs, retained and retested. |
| SCRUM-231 FRIEND-04 | Existing symmetric pending-pair checks, unique constraints and ordered account locks retained and retested. |
| SCRUM-232 FRIEND-05 | Add authenticated incoming pending request collection. |
| SCRUM-233 FRIEND-06 | Existing atomic acceptance reused, with its permissions, rollback and concurrency tests retained. |
| SCRUM-234 FRIEND-07 | Add recipient-only rejection through the existing request resolution transaction. |
| SCRUM-235 FRIEND-08 | Add participant-only removal of the canonical friendship. |
| SCRUM-236 FRIEND-09 | Verify signed principal isolation, recipient/participant permissions and revocable verified sessions. |
| SCRUM-237 FRIEND-10 | Test full lifecycle, concurrent transitions and failure recovery. |
| SCRUM-446 TEST-05 | Add PostgreSQL HTTP regression suite and rerun existing Friends suites. |

Owned files are `src/friends/friends.controller.ts`, `friends.service.ts`,
`friends.types.ts`, the new `friends-workflow.e2e-spec.ts`, and this document.
No migrations, presence implementation, authentication implementation, realtime
implementation, shared modules or package dependencies change.

## Routes and responses

All routes below require a verified account with an unexpired, unrevoked bearer
session. Actor identity comes from that session; query parameters, headers and
request payloads cannot select a different actor.

| Method | Route | Success |
| --- | --- | --- |
| GET | `/v1/friends` | 200 `{ friends: [...] }` (existing). |
| POST | `/v1/friends/requests` | 201 safe request DTO (existing), body `{ recipientId }`. |
| GET | `/v1/friends/requests` | 200 `{ requests: [...] }`, only incoming `PENDING` requests, oldest first with UUID tie-breaking. Empty inbox returns `{ requests: [] }`. |
| POST | `/v1/friends/requests/:requestId/accept` | 200 request with `status: ACCEPTED` (existing). |
| POST | `/v1/friends/requests/:requestId/reject` | 200 request with `status: REJECTED`; only the recipient may resolve it. |
| DELETE | `/v1/friends/:friendId` | 204 with empty body; `friendId` identifies the other account, and either participant may remove the relationship. |

The request DTO contains exactly `id`, `senderId`, `recipientId`, `status` and
`createdAt` (ISO-8601 UTC). It never exposes email, credentials, sessions or a
joined private profile. Received requests omit sent, accepted and rejected rows.
The accepted friends list keeps its existing public fields and live presence.

## States, concurrency and errors

Each request transitions once from `PENDING` to `ACCEPTED` or `REJECTED`.
Accepted requests remain historical after removing a friendship. A finalized
request cannot restore a removed friendship: the sender must create a new
request, and the other participant must accept it. A rejected request also permits
a new request in either direction. Removal does not cancel unrelated requests or
delete request history.

All pair mutations lock both account rows in ascending UUID order. Resolution
then locks and re-reads the request before checking recipient and status.
Concurrent accept/reject operations therefore produce one final transition;
concurrent opposite sends still produce at most one pending request. Removal
uses the same pair lock and can run safely against sends or request resolution.
If a removal races an acceptance, either it observes and removes the new
friendship, or it returns 404 before the acceptance commits; it does not cancel
an incoming request. Repeated removal returns 404. Transaction errors roll back
request updates and friendship changes and release their locks for retries.

| HTTP | Code / condition |
| --- | --- |
| 400 | Invalid path UUID; existing create validation also rejects supplied sender/status and invalid recipient. |
| 400 | `FRIEND_REQUEST_SELF` for requests to oneself. |
| 401 | `AUTH_REQUIRED` for missing, invalid, expired or revoked sessions or unverified accounts. |
| 403 | `EMAIL_NOT_VERIFIED` if verification changes after authentication but before the mutation. |
| 403 | `FRIEND_REQUEST_FORBIDDEN` when the sender or an outsider tries to resolve a request. |
| 404 | `FRIEND_REQUEST_NOT_FOUND` for an unknown request; `FRIENDSHIP_NOT_FOUND` if the actor has no relationship with that account. |
| 409 | `FRIEND_REQUEST_FINALIZED`, `FRIEND_REQUEST_PENDING` or `ALREADY_FRIENDS`, according to the existing pair/request state. |
| 500 | Unexpected database failure; no partial transition is committed. |

No Friends mutation changes online connections, game presence, last-seen
calculation or existing notification producers. Presence continues to query the
canonical friendships table when determining authorized friend notifications.

## Validation

Run from `srcs/nestJS/42chess` with the repository's isolated test services:

```sh
npm run build
npm run test:contracts
npx vitest run --config vitest.config.e2e.ts src/friends
npm test
npx vitest run --config vitest.config.database.ts test/presence-seen.integration-spec.ts
npx vitest run --config vitest.config.e2e.ts test/friends-presence.e2e-spec.ts test/presence-online-events.e2e-spec.ts test/presence-offline-events.e2e-spec.ts test/session.e2e-spec.ts
npm run lint
```

The worker uses Node 22 in `pr61-api:latest`, existing backend dependencies
mounted read-only with temporary Vite caches, and the dedicated
`sprint4-daily-postgres:5432` service on `sprint4-daily-net`. It has exclusive use
of that test database during validation. The real rules daemon is
`ws://sprint4-daily-chess-isolated:8081`; no production database or private `.env`
is used. Injected rejection/removal database errors in the new suite deliberately
produce HTTP 500 and prove rollback and successful retry.

Executed on 2026-10-28:

| Check | Result |
| --- | --- |
| Backend build | Pass |
| TypeScript contracts | Pass |
| Existing and new Friends HTTP suites | 34 passed, 4 files; new lifecycle suite 11 passed |
| All backend unit suites | 483 passed, 38 files |
| PostgreSQL presence lastSeen integration | 4 passed, 1 file |
| Friends presence, online/offline notifications and sessions E2E | 13 passed, 4 files |
| Final lifecycle rerun after comparator lint fix | 11 passed, 1 file |
| Backend lint | Pass, 0 errors and 28 existing warnings outside Friends |
| `git diff --check` and added-content secret review | Pass |

No tests or workflows were skipped, disabled or changed to obtain these results.
