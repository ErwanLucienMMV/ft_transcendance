# SCRUM-486 · Friend-request authorization verification

Reviewed 2 November 2026 on `dev_test` at `062aaa6`.

The existing friend-request API enforces authenticated ownership and
recipient-only acceptance/rejection. No production correction was required.

| Operation | Existing executable evidence |
| --- | --- |
| Send | `friends-send.e2e-spec.ts` derives the sender from the signed principal despite forged query/header identities |
| Input | Sender/status fields and invalid recipient UUIDs are rejected; missing/invalid/unverified senders cannot send |
| Accept | `friends-accept.e2e-spec.ts` rejects both sender and outsider with FRIEND_REQUEST_FORBIDDEN despite forged recipient headers/query/body |
| Preserve state on denial | The request remains PENDING and no friendship is inserted |
| Reject | `friends-workflow.e2e-spec.ts` forbids sender/outsider rejection and preserves unrelated relationships |
| Remove | Only a participant can remove the canonical pair; forged identity cannot delete another pair |
| Revoke | Verified revocable sessions are required on the workflow endpoints |
| Atomicity | Concurrent operations serialize and database-injected failures roll back without partial friendship/request changes |

An incoming request belongs to its recipient, while an accepted friendship
allows either participant to remove it. These distinct permissions are
intentional. List responses are actor-scoped and expose safe public friend
fields rather than private account credentials.

Validation: baseline build and TypeScript contracts passed. The full acceptance
run passed **362 tests in 41 files**, including all four friend suites in
`src/friends`; integration passed **408 tests in 28 files**. The run used
production source `062aaa6` in the sibling OAuth verification worktree, with
dedicated test PostgreSQL/rules/bot services. Injected database failure logs are
expected; Vite retains its existing path-plugin notice.

Reproduce from `srcs/nestJS/42chess` with dedicated test fixtures running:

```sh
npm run build
./node_modules/.bin/vitest run --config vitest.config.e2e.ts src/friends
```

No Jira status or production data was changed. The evidence verifies the
existing implementation without introducing redundant authorization layers.

## Later change

Declining moved from `POST /v1/friends/requests/:id/reject` to
`DELETE /v1/friends/requests/:id`, which also lets the sender withdraw a
request they sent (see [social](social.md)). Only the recipient and the sender
can delete it: for an outsider the request does not exist
(`404 FRIEND_REQUEST_NOT_FOUND`) and it stays pending. Accepting is still
recipient-only (`403 FRIEND_REQUEST_FORBIDDEN`).
`src/friends/friends-workflow.e2e-spec.ts` covers these cases.

Sources: [controller](../srcs/nestJS/42chess/src/friends/friends.controller.ts),
[send tests](../srcs/nestJS/42chess/src/friends/friends-send.e2e-spec.ts),
[accept tests](../srcs/nestJS/42chess/src/friends/friends-accept.e2e-spec.ts),
[workflow tests](../srcs/nestJS/42chess/src/friends/friends-workflow.e2e-spec.ts).
