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
