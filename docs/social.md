# Social controls and live social events

What players can do about each other beyond friendship and messages: block, choose who may
reach them, follow requests and conversations live, and challenge from a conversation. API
routes are given as NestJS sees them (`/v1/...`); behind Nginx they start with `/api/v1`.

## Blocking

| Route (bearer required) | Behavior |
| --- | --- |
| `GET /v1/blocks` | `{ users: [{ id, username, avatarUrl, blockedAt }] }`, alphabetical |
| `PUT /v1/blocks/:userId` | 204. Idempotent. `400 BLOCK_SELF`, `404 USER_NOT_FOUND` |
| `DELETE /v1/blocks/:userId` | 204. Idempotent |

- Blocking ends what links the two players, in one transaction that takes the same pair
  locks as friend requests: their friendship, pending requests both ways, and waiting
  challenges between them (with their chat lines). Both sides get the matching
  `FRIEND_REMOVED` / `FRIEND_REQUEST_REMOVED` events, so their pages update.
- From then on, in **both** directions, private messages, challenges (`POST /v1/games` with
  an `opponentId`) and friend requests are refused with `403 USER_BLOCKED`. The blocker reads
  "You blocked this player. Unblock them to …", the other "You cannot … this player." The
  blocked player is not told otherwise. Typing hints between them are dropped, and so are
  read receipts: reading the old conversation is no longer shown to the other side.
- Existing conversations stay readable. Games already running are not touched.
- Stored in `user_blocks` (`blockerId`, `blockedId`, unique pair, no self-block, cascade on
  user deletion). The export lists blocked players; account deletion removes every block
  involving the account.
- Front: **Block player** on a profile and **Block** in a conversation header, each after a
  confirmation; the Settings page lists blocked players with **Unblock** (Privacy section,
  `/settings#privacy`, also linked from the friends page). A conversation with a blocked
  player shows its history with an **Unblock** button instead of the message box.

## Only friends can message or challenge me

`PATCH /v1/users/me` `{ preferences: { messagesFromFriendsOnly: true } }`. While it is on,
messages and challenges from players who are not friends are refused with
`403 FRIENDS_ONLY` ("This player only lets friends …"). Friend requests still work, so a
stranger can ask first; the player can still write to anyone. Default `false`; the
migration adds the key to every account and to the database check on `preferences`.
Front: a switch in Settings, Privacy.

## Friend requests

| Route | Behavior |
| --- | --- |
| `POST /v1/friends/requests` `{ recipientId }` | 201. Status `ACCEPTED` when the recipient had already asked: you are friends at once |
| `GET /v1/friends/requests` | Pending requests received |
| `GET /v1/friends/requests/sent` | Pending requests sent |
| `POST /v1/friends/requests/:id/accept` | Recipient only |
| `DELETE /v1/friends/requests/:id` | 204. The recipient declines it, the sender withdraws it (the row is deleted) |

- `POST …/:id/reject` is gone: `DELETE` does both jobs, as the subject's §5 describes.
- After a decline, the same sender waits three days before asking again
  (`409 FRIEND_REQUEST_DECLINED_RECENTLY`). Only the pair's latest answer counts: once they
  became friends later, an old decline no longer holds anyone back. The player who declined
  can ask at any time. Requests now record `resolvedAt`.
- Two crossed requests no longer meet a 409: the second one accepts the first.
- Front: the friends page lists **Sent requests** with **Cancel**; a profile knows a request
  sent or received after a reload and offers **Cancel request**, or **Accept** and
  **Decline**. The 30-second polling of the inbox is gone: events keep the page current, and
  it reads everything again after the socket reconnects.

## Live events

Sent to every open socket of the players named, after the change is saved.

| Event | To | Data |
| --- | --- | --- |
| `FRIEND_REQUEST_RECEIVED` | recipient | `{ request, sender: { id, username, avatarUrl, elo, lastSeenAt } }` |
| `FRIEND_REQUEST_SENT` | sender (other tabs) | `{ request }` |
| `FRIEND_REQUEST_REMOVED` | both | `{ requestId }` (declined, withdrawn or ended by a block) |
| `FRIEND_ADDED` | both | `{ requestId, friend: { id, username, avatarUrl, elo, lastSeenAt, status } }` |
| `FRIEND_REMOVED` | both | `{ userId }` (the other player) |
| `CHALLENGE_RECEIVED` | invited player | `{ gameId, from: { id, username, avatarUrl, elo }, initialTime, increment, rated }` |
| `MESSAGES_READ` | both | `{ readerId, senderId, readAt, messageIds }` |
| `TYPING` | the other player | `{ userId }` |

`UserEvents` (`src/social/user-events.ts`) indexes sockets by user and checks each session
before delivery, like private messages. Events are hints: a reconnect replays nothing, and
pages read the HTTP state again.

A signed-in player gets a short notice on any page for a challenge (**Open the game**, one
minute) or a friend request (**See the request**, 20 s), except on the page that already
shows it. Opening that page clears the notice.

## Read receipts and typing

- `POST /v1/conversations/:userId/read` (204) marks every message from that player as read
  and sends `MESSAGES_READ`. Messages now carry `readAt`. The conversation list's unread
  count is the server's, so it stays right after a reload.
- The messages page marks a conversation read when it opens it, when a message arrives in
  it, and when the tab becomes visible again, only if something is unread. Under the last
  message the player sent, it shows "Sent" or "Read 14:02".
- `TYPING { receiverId }` over the socket. The server drops it silently when malformed, more
  frequent than every 2 s per pair, when the receiver is offline, or when the sender may not
  write to them (block, friends only). The page sends at most one every 2 s while the box is
  not empty, and shows "… is typing" for 4 s after the last hint or until their message
  arrives.

## Challenge from a conversation

A **Challenge** button in the conversation header does what the friend list's does (a
10-minute game reserved for that player, its link by message, then the game). A refusal
(`USER_BLOCKED`, `FRIENDS_ONLY`, `ACTIVE_GAME_EXISTS`…) is shown in the header.

## Game chat: spectators

Spectators' lines are marked "spectator". A seated player can switch **Hide spectators**: their
lines are hidden (with a count), the choice is remembered in the browser
(`42chess.chat.hideSpectators`). Spectators do not get the switch.

## Tests

- Backend: `test/social-controls.e2e-spec.ts` (real sockets and PostgreSQL: blocking effects
  and refusals both ways, friends only, events of requests, friendships and challenges, read
  receipts, typing throttle), `src/friends/*.e2e-spec.ts` (crossed requests, cooldown,
  withdrawal, races), `test/private-message-history.e2e-spec.ts` (mark read),
  `test/account.e2e-spec.ts` (export and deletion of blocks).
- Front: `users-api.spec.ts`, `friends-page.spec.ts`, `profile-page.spec.ts`,
  `messages-api.spec.ts`, `messages-page.spec.ts`, `settings.spec.ts` (privacy),
  `social-notices.spec.ts`, `game-chat.spec.ts`.
- Playwright: `e2e/social-controls.e2e.ts` (receipts, typing, challenge notice; block, the
  Privacy section, friends only), `e2e/friends.e2e.ts` (request notice, request still known
  after a reload).
