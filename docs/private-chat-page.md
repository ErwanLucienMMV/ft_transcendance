# Private chat page (lot 28)

Jira: FRONT-CHAT-01 to 06 and FRONT-CHAT-10 (SCRUM-381 to 386, SCRUM-390), FTEST-10
(SCRUM-464). The backend is the one described in [private-messaging.md](private-messaging.md);
it was not changed.

## Files

| File | Role |
|---|---|
| `srcs/angular/42chess/src/app/features/chat/messages-api.ts` | REST history, conversation list, WebSocket send and the `PRIVATE_MESSAGE` stream |
| `srcs/angular/42chess/src/app/features/chat/messages-page.ts` | `/messages` and `/messages/:userId` |
| `srcs/angular/42chess/src/app/features/social/profile-page.html` | "Message" link on another player's profile |
| `srcs/angular/42chess/e2e/messages.e2e.ts` | Two live accounts, plus an offline recipient |

## Flow

- `/messages` lists the conversations (`GET /v1/conversations`), newest first, with the
  last message ("You: " for your own) and the unread count.
- `/messages/:userId` opens a conversation. The peer comes from `GET /v1/users/:id`, so an
  unknown id says "This player does not exist." and your own id is refused.
- History loads 30 messages at a time (`GET /v1/conversations/:userId/messages`), oldest at
  the top. "Load older messages" uses the number already loaded as the offset, and
  messages are deduplicated by id.
- Sending goes through the realtime socket (`SEND_PRIVATE_MESSAGE`). The message is shown
  once its own `PRIVATE_MESSAGE` comes back, which also reaches the other tabs of both
  accounts. Enter sends, Shift+Enter adds a line.
- Validation mirrors the backend: blank text is refused, and the counter shows
  `n / 2000` code points (an emoji counts as one).
- A peer who is offline gets the note "X is offline. They will find your messages when
  they come back." Presence uses the `online` field of the profile, then the pushed
  presence events.
- After a reconnection the list and the open history are reloaded.
- Under 720px the list and the conversation take turns on the screen.

## Known limits of the API

- Nothing marks messages read, so an unread count comes back after a reload. The page
  shows 0 for conversations opened during the visit.
- `ERROR` events carry no correlation id. While a message is pending, the page treats an
  `ERROR` as the answer to it; after 10 s with no answer it reloads the newest page.

## Tests

- Unit: `messages-api.spec.ts` (3) and `messages-page.spec.ts` (16), plus the profile link.
- Playwright `e2e/messages.e2e.ts`: Alice and Bob exchange messages live (unread count,
  multi-line, 2001 characters refused), and Carol reads a message sent while offline.
