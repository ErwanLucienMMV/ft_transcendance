# Private messages

Implements SCRUM-249, SCRUM-252, SCRUM-253 and SCRUM-254 using the existing
`messages` PostgreSQL table and spec §22 (`Proposition spec.md`). No new schema
or migration is needed: `Message` already stores both participants, content,
creation time and optional read time, with foreign keys and content constraints.

Messages belong to accounts. Neither persistence nor retrieval depends on
WebSocket connections, presence, friendship or joining a chat room.

## HTTP history

Routes use the normal `/api` reverse proxy prefix and require a revocable bearer
session. Nest handles the following paths:

- `GET /v1/conversations` returns `{ conversations: [{ user: { id, username },
  lastMessage, unreadCount }] }`, one entry per peer, newest message first.
- `GET /v1/conversations/:userId/messages?limit=20&offset=0` returns
  `{ messages, total, limit, offset }` for the authenticated account and that
  peer, in both directions. An unrelated account receives only its own history.

History is newest first, ordered by `createdAt DESC, id DESC` for deterministic
ties. `limit` is 1–100 (default 20); `offset` is a nonnegative safe integer
(default 0). As with other offset-paginated APIs, new arrivals can shift offsets;
clients should deduplicate by message ID when loading older pages during live use.

The public message shape is `{ id, senderId, receiverId, content, createdAt }`.
Database `recipientId`, read state, relations and private account fields are not
exposed. Conversation unread counts include only incoming rows with no `readAt`;
fetching history does not mark them read. Read receipts are outside these tickets.

The persistence service accepts nonblank text of at most 2000 Unicode code
points, preserving the original content and rejecting NUL. It checks the peer
exists and rejects self-messages. IDs and timestamps come from PostgreSQL. A
successful send returns only after the row is committed; a recipient can be
offline throughout.

## Validation

From `srcs/nestJS/42chess`, with the isolated PostgreSQL test fixture running:

```sh
npm run build
npx vitest run --config vitest.config.e2e.ts test/private-message-history.e2e-spec.ts
```

These tests exercise real sessions, controllers and PostgreSQL, including an
independent connection reading a newly sent message, account isolation,
equal-timestamp pagination, exact public projections, unread counts, input
validation and the storage length boundary.

## WebSocket send and delivery

SCRUM-256 uses the existing authenticated `/ws` transport (also spec §22):

```json
{ "event": "SEND_PRIVATE_MESSAGE", "data": { "receiverId": "uuid", "content": "Hello!" } }
```

The authenticated session supplies the sender. Additional fields, including
client-supplied IDs, timestamps or authors, are rejected. On successful commit,
`PRIVATE_MESSAGE` contains the public message shape above. It is sent to all
connected, still-valid sessions of the sender and receiver. No room join,
friendship or online recipient is required. Existing game/presence/matchmaking
events continue on the same socket.

A failed save emits only `ERROR` to the sending connection. Once saved, a broken
or revoked receiving socket does not make the send fail or stop delivery to
another valid session. Socket delivery is best effort on the current backend
process; HTTP history is authoritative, including after reconnect or restart.
No read receipt is inferred from delivery, and reconnect does not replay events
automatically: retrieve history and deduplicate by message ID. Retransmitting a
send is a new message (there is no client idempotency key in this contract).

The realtime acceptance suite uses production session authentication and verifies
multiple tabs, an offline receiver and a complete application restart, revoked
receiving/sending sessions, invalid/spoofed payloads and injected save failure:

```sh
npm run build
npx vitest run --config vitest.config.e2e.ts test/private-message-history.e2e-spec.ts test/private-message-realtime.e2e-spec.ts
npm test -- src/chat/private-message-realtime.spec.ts
```

The unit tests additionally hold persistence pending to prove nothing is emitted
before commit, and simulate broken transports and disconnects during validation.
