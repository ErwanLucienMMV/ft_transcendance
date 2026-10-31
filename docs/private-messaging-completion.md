# Private messaging ticket verification

Reference: `origin/dev_test` at `b49b735`, fetched on 31 October 2026.
The seven Jira descriptions contain only their epic and ticket labels; expected
behavior follows spec section 22 and the existing [messaging contract](private-messaging.md).

All seven requested capabilities were already present on this reference. The
conversation model is the durable pair of account IDs in `Message`, with a
conversation summary projected from their messages. It does not require a
separate conversation table, socket room, friendship, or an online recipient.

| Ticket                                                                       | Implementation and verification                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SCRUM-248 / MSG-01](https://42transcendance.atlassian.net/browse/SCRUM-248) | `messages.entity.ts` owns both participants, content, timestamps, foreign keys and constraints. The history and PostgreSQL suites verify isolated conversations, ordering and unread counts.                                       |
| [SCRUM-250 / MSG-03](https://42transcendance.atlassian.net/browse/SCRUM-250) | `PrivateMessagesService.send()` persists before success, derives the author from authentication and preserves valid content. Tests verify committed rows, exact public fields and failed writes.                                   |
| [SCRUM-251 / MSG-04](https://42transcendance.atlassian.net/browse/SCRUM-251) | Recipient UUID and existence are checked before inserting. The new service tests also cover disappearance between the check and the write.                                                                                         |
| [SCRUM-255 / MSG-08](https://42transcendance.atlassian.net/browse/SCRUM-255) | Initially missing and concurrently deleted recipients both return `404 USER_NOT_FOUND`. The real PostgreSQL/WebSocket regression verifies no saved row or success event and a subsequent valid send on the same socket.            |
| [SCRUM-257 / MSG-10](https://42transcendance.atlassian.net/browse/SCRUM-257) | `PrivateMessageRealtime` emits `PRIVATE_MESSAGE` after commit to valid sessions of both participants. Existing tests cover multiple tabs, outsider isolation, revoked sessions and bounded delivery validation.                    |
| [SCRUM-258 / MSG-11](https://42transcendance.atlassian.net/browse/SCRUM-258) | Offline messages survive reconnect and a complete application restart. New acceptance coverage checks a two-message backlog, HTTP recovery, bidirectional live delivery after reconnect and absence of automatic replay.           |
| [SCRUM-259 / MSG-12](https://42transcendance.atlassian.net/browse/SCRUM-259) | Real WebSockets, revocable sessions, HTTP and PostgreSQL are exercised together. New scenarios verify ordered queued sends around a rejected command and completion after the sending socket disconnects with persistence pending. |

The correction only translates PostgreSQL `23503` on
`FK_messages_recipientId` into the existing public not-found response. Foreign
keys, sender checks and other database errors retain their existing behavior.
No schema changes or data migration are needed.

## Branches and milestones

- `fix/private-message-recipient-race`: production correction, seven service
  regression cases, one WebSocket/PostgreSQL regression, contract documentation.
- `test/private-message-lifecycle`: based on the correction branch; three more
  acceptance scenarios, explicit decoding of the WebSocket raw-data union and
  this ticket mapping. Review the second branch against the first branch to
  see only its milestone.

The two branches preserve all commits from `dev_test`. No remote branches,
pull requests, Jira statuses or Jira comments were changed.

## Reproduction

Validation on 31 October 2026: **150 tests passed** (60 focused unit and gateway
tests, 33 HTTP/WebSocket acceptance tests, 57 PostgreSQL constraint and upgrade
tests). NestJS build, public TypeScript contracts, lint of the changed TypeScript
files, formatting of all changed files and `git diff --check` passed. This is
focused messaging validation; the complete repository test suite and frontend
browser suite were not run. The dedicated PostgreSQL fixture was left running.

Use the dedicated PostgreSQL fixture, never an application database. From
`srcs/nestJS/42chess`:

```sh
docker compose -f test/docker-compose.yml up -d --build --wait postgres-test
npm run build
npm run test:contracts
./node_modules/.bin/vitest run src/chat src/messages src/common/pagination.spec.ts src/realtime/realtime.gateway.spec.ts
./node_modules/.bin/vitest run --config vitest.config.e2e.ts test/private-message-history.e2e-spec.ts test/private-message-realtime.e2e-spec.ts test/private-message-adversarial.e2e-spec.ts
./node_modules/.bin/vitest run --config vitest.config.database.ts test/private-message-adversarial.integration-spec.ts test/private-message-constraint.integration-spec.ts test/database-upgrade.integration-spec.ts
./node_modules/.bin/oxlint --type-aware src/chat/private-messages.service.ts src/chat/private-messages.service.spec.ts test/private-message-realtime.e2e-spec.ts
./node_modules/.bin/prettier --check src/chat/private-messages.service.ts src/chat/private-messages.service.spec.ts test/private-message-realtime.e2e-spec.ts ../../../docs/private-messaging.md ../../../docs/private-messaging-completion.md
git diff --check
```

The recipient-race regression was run before the correction and reproduced
`500 INTERNAL_SERVER_ERROR` instead of `404 USER_NOT_FOUND`. The service
regression failed for the same missing translation. The existing database
foreign key prevented an orphan row throughout.

Socket checks require local network access: the initial sandboxed gateway run
failed with `listen EPERM`; rerunning with socket access passed. Vite emits a
non-failing notice about native TypeScript path resolution; configuration and
test coverage are preserved.
