# SCRUM-485 · Private-message authorization verification

Reviewed 2 November 2026 on `dev_test` at `062aaa6`.

Private-message authorization is already implemented. This ticket records
executable evidence without changing production behavior.

| Requirement | Existing acceptance evidence |
| --- | --- |
| History belongs to the signed actor | `private-message-history.e2e-spec.ts` returns only the caller's history with the requested peer |
| Outsider isolation | An outsider requesting another pair receives an empty own conversation; adding forged senderId is rejected with 400 |
| Verified identity | History requires a real session; anonymous, malformed or invalid credentials are refused |
| Sender ownership | `private-message-realtime.e2e-spec.ts` rejects spoofed authors and invalid recipients/content before persistence or broadcast |
| Participant delivery | A committed message reaches the two participants and their tabs, not unrelated accounts |
| Revocation | A revoked sender cannot persist a message; recipient sessions are revalidated while another valid session still receives it |
| Atomic failure | Persistence failure emits no success acknowledgement and leaves the next valid send usable |

The peer UUID is not an arbitrary conversation id: the authenticated actor is
always one endpoint of the history query. A third party cannot select both
participants through parameters. Fetching history does not silently change read
status. Offline messages are durable and recovered by actor-scoped pagination.

Validation: the complete baseline HTTP/WebSocket acceptance suite passed
**362 tests in 41 files** on production source `062aaa6`, including private
history, realtime and adversarial cases. Database integration passed
**408 tests in 28 files**. The run used the sibling OAuth verification worktree,
with identical production source and dedicated test fixtures. Build and public
TypeScript contracts passed. Expected injected-outage logs and the existing
Vite path-plugin notice remain visible.

Reproduce from `srcs/nestJS/42chess` with isolated test services running:

```sh
npm run build
./node_modules/.bin/vitest run --config vitest.config.e2e.ts test/private-message-history.e2e-spec.ts test/private-message-realtime.e2e-spec.ts test/private-message-adversarial.e2e-spec.ts
```

This does not audit live credentials, deployments or other users' private data.
No new production rule was needed and no tests were removed or relaxed.

Sources: [history controller](../srcs/nestJS/42chess/src/chat/conversations.controller.ts),
[history tests](../srcs/nestJS/42chess/test/private-message-history.e2e-spec.ts),
[realtime tests](../srcs/nestJS/42chess/test/private-message-realtime.e2e-spec.ts).
