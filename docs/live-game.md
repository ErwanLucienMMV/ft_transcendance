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

Realtime rooms are for the two players only (the server answers `NOT_A_PLAYER`). Someone
else who opens an active game gets a read-only board from `GET /api/v1/games/:id`. Live
spectating (`START_SPECTATING`) belongs to the SPEC lot.

## Browser tests

`srcs/angular/compose.e2e.yml` now also starts the chess engine and the bot, because the
API needs them to accept a move.
