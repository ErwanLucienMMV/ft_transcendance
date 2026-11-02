# Game chat and friend challenge

Jira: GAMECHAT-02 to 08 (SCRUM-261 to 267), TEST-11 (SCRUM-452), E2E-11 (SCRUM-476),
FRONT-CHAT-07 to 09 (SCRUM-387 to 389), FRONT-SOCIAL-10 (SCRUM-344), E2E-04 (SCRUM-469).
GAMECHAT-01 (the `game_messages` table) already existed.

## Protocol (spec §21)

`SEND_GAME_MESSAGE { gameId, content }` on the signed-in socket, from a connection in the
game's room. Once the row is committed, the room receives
`GAME_MESSAGE { id, gameId, sender: { id, username }, content, createdAt }`.

- Players and spectators may write: being in the room is what counts. Anyone else gets
  `403 ROOM_REQUIRED`.
- Content follows the private message rules (`isMessageContent`): nonblank, at most 2000 code
  points, no NUL or unpaired surrogate. Any other field is refused.
- A finished game refuses messages with `409 GAME_ALREADY_FINISHED`. The clock is settled
  first, so a game lost on time is closed even before the next tick.
- Commands of one game run in its queue, so messages keep their order. Chat may use only half
  of that queue (`429 TOO_MANY_REQUESTS` beyond), so it cannot get a move refused.
- An `ERROR` answering this command carries `event: "SEND_GAME_MESSAGE"`: the chat handles it, and
  the board ignores it.

The spec has no history route, but a page that opens or reconnects needs one:
`GET /v1/games/:id/messages?limit=20&offset=0` returns `{ messages, total, limit, offset }`,
newest first, to any signed-in user, as games themselves are public to them (spec §28).

## Page

`app-game-chat` sits under the moves of the game page, for players and spectators. It loads the
latest 100 messages and adds live ones, deduplicated by id. After a reconnection it reads them
again, and starts from the new page if nothing joins it to what was shown. Sending works like
the private messages page: Enter sends, Shift+Enter adds a line, and the draft stays until the
message comes back. Bot games have the chat too, for their spectators.

## Challenge

**Challenge** on the friend list and on a friend's profile creates a 10-minute game reserved for
that friend (`opponentId`), sends the friend its link by private message and opens the game. The messages page shows
"Open the game" under a challenge, only for the exact text with this site's address; the friend
takes the other seat by opening it. No backend was added, so there is no accept or decline
event: declining is not opening the link. Offline, the button says so and creates nothing. The seat is taken only
while the creator is on the game (`409 OPPONENT_AWAY` otherwise), so an old link cannot start a
clock against someone who left.

## Tests

- Backend: `src/realtime/game-realtime.service.spec.ts` and `test/game-chat.e2e-spec.ts` (real
  sessions, sockets and PostgreSQL).
- Front: `game-chat.spec.ts`, `challenge.spec.ts`.
- Playwright `e2e/game-chat.e2e.ts`: challenge from the friend list, chat between players and a
  spectator, reload, length limit, chat closed at the end.
