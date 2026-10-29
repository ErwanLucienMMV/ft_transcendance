# Accept a friend request

`POST /v1/friends/requests/:requestId/accept` requires a verified account's bearer access token backed by an unexpired, unrevoked persisted session. The request ID must be a UUID. Only the request's recipient can accept it; identity comes from the access token.

Success returns HTTP 200 with the safe request fields:

```json
{
  "id": "request UUID",
  "senderId": "sender UUID",
  "recipientId": "recipient UUID",
  "status": "ACCEPTED",
  "createdAt": "2026-10-26T12:00:00.000Z"
}
```

Acceptance updates the request and inserts one canonical friendship in a single transaction. Both users then see the other in `GET /v1/friends`. If either write fails, both roll back. Concurrent accepts and sends serialize on the pair's user rows, locked in ascending UUID order, before locking and re-reading the request.

| HTTP | Condition | Code |
| --- | --- | --- |
| 400 | Invalid request UUID | Nest UUID validation error |
| 401 | Missing, invalid, expired or revoked session; deleted or unverified account | `AUTH_REQUIRED` |
| 403 | Account becomes unverified after authentication but before the transaction | `EMAIL_NOT_VERIFIED` |
| 403 | Sender or unrelated account attempts acceptance | `FRIEND_REQUEST_FORBIDDEN` |
| 404 | Request does not exist | `FRIEND_REQUEST_NOT_FOUND` |
| 409 | Request is already accepted or rejected | `FRIEND_REQUEST_FINALIZED` |
| 409 | Friendship already exists | `ALREADY_FRIENDS` |

Repeated acceptance returns 409 and never creates another relationship.

Verification: build the Nest service and run `npx vitest run --config vitest.config.e2e.ts src/friends/friends-accept.e2e-spec.ts src/friends/friends-send.e2e-spec.ts` from `srcs/nestJS/42chess`, with the dedicated PostgreSQL test fixture running on port 55432.

Integration with presence: the friends list retains live `status` (`ONLINE`, `IN_GAME`, `OFFLINE`) and case-insensitive username ordering, while also returning public `avatarUrl` and `lastSeenAt` fields. No private account fields are exposed.
