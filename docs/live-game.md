# Live game page (lot 19)

Jira: FRONT-GAME-01 to 17 (SCRUM-357 to 373), FTEST-05 (SCRUM-459) and FTEST-08 (SCRUM-462).

## Files

| File | Role |
|---|---|
| `srcs/angular/42chess/src/app/core/realtime/game-realtime.ts` | `GameRealtime`: joins one game room and keeps its snapshot up to date |
| `srcs/angular/42chess/src/app/features/game/game-page.ts` | `/game/:id`, the live game page |
| `srcs/angular/42chess/src/app/features/game/play-page.ts` | `/play`, creates a game against a friend |
| `srcs/angular/42chess/src/app/features/game/game-clock.ts` | `<app-game-clock>` |
| `srcs/angular/42chess/src/app/features/game/games-api.ts` | REST calls: create a game, read one |
| `srcs/angular/42chess/e2e/game.e2e.ts` | Two browsers play a full game against the real API and engine |

Both routes need a session (`authGuard`) and render in the browser only, like `/session`.

## Flow

1. `/play`: the player picks a time control and `POST /api/v1/games` creates a
   `WAITING` game. The page opens `/game/<id>`.
2. The game page sends `JOIN_GAME`. The creator sees the invitation link. The first other
   signed-in user who opens the link takes the free seat (the server does this inside
   `JOIN_GAME`), and the game becomes `ACTIVE`.
3. Moves: the board emits `moved`, the page sends `MAKE_MOVE`. While the request is in
   flight the move is drawn as a preview and the board is locked. The next `GAME_STATE`
   replaces the preview; an `ERROR` removes it and shows a message.
4. `MOVE_PLAYED` updates the board, the move list and the clocks at once; the `GAME_STATE`
   that follows stays the authoritative snapshot.
5. Resign asks for a confirmation. Draw: offer, accept, decline (`DRAW_OFFERED`,
   `DRAW_DECLINED`). Draw buttons are hidden in bot games, which the server refuses.
6. `GAME_ENDED` or a `FINISHED` snapshot shows the result from the viewer's side
   ("You won by checkmate") and links to a new game.

## Clocks

The server sends `CLOCK_UPDATE` every second. Between two updates the page counts down
the side to move locally from the time the last value arrived, so the display stays
smooth; every server value replaces the local estimate. Under ten seconds tenths are shown.

## Connection

`RealtimeService` reconnects by itself (5 tries, 0.5 s to 8 s) and joins the game again.
The page shows "Connection lost. Reconnecting…" meanwhile, and a **Reconnect** button once
it gives up. A command lost with its connection is not resent: the rejoin brings the state.
A page reload works the same way, thanks to the refresh cookie of lot 18.

## Not seated

`JOIN_GAME` is for the two players only (the server answers `NOT_A_PLAYER`). Someone else
who opens a started game watches it live as a spectator instead: see
`docs/spectator-mode.md`.

## Browser tests

`srcs/angular/compose.e2e.yml` now also starts the chess engine and the bot, because the
API needs them to accept a move.

# Bot games (lot 20)

Jira: FRONT-BOT-01 to 07 (SCRUM-406 to 412).

- `/play` has a second card, **Play the computer**: difficulty (Easy, Medium, Hard, with
  the search depth from `srcs/bot/README.md`), colour (White, Black or Random, drawn in the
  browser because the API takes `WHITE` or `BLACK`) and the shared time control.
  `POST /api/v1/games/bot` creates the game, already `ACTIVE`, and the page opens it.
- The game page is the same as for a human game. The bot is named "Computer · Medium",
  draw buttons are hidden, and the bot seat shows a thinking indicator while it owes a
  move: from the moment my move is sent until its reply arrives, or from the start when I
  play Black.
- The bot reply arrives over the WebSocket like any move: the server commits my move and
  the bot reply together and announces two `MOVE_PLAYED` events.
- If the bot engine fails, the server keeps the game waiting for the bot (`botError`).
  The page says so and offers **Ask the bot to play**, which calls
  `POST /api/v1/games/:id/bot-move`; the room then receives the move.
- The server allows one active bot game per player; its message is shown as is.

## Backend fix

`POST /v1/games/bot` answered 401 to every signed-in player: `BotsModule` builds its own
`GameActorGuard`, and without `SessionModule` in its imports the guard had no
`SessionService` to check the bearer. The existing controller test hid this because it
installs the user through a test middleware. `BotsModule` now imports `SessionModule`, and
`test/bot-session.e2e-spec.ts` covers the route with a real session.
