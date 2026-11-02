# Game history and replay (lot 22)

Jira: HISTORY-01 to 08 (SCRUM-278 to 285) and FRONT-HISTORY-01 to 07 (SCRUM-399 to 405).

HISTORY-01 and 02 were already met by the game module: every game, its result, end reason
and every move (UCI, SAN and FEN after the move) are stored as they happen.

## API

`GET /api/v1/users/:id/games?limit=20&offset=0`, public like `GET /games/:id` and the
rating history. Finished games only, newest first (`finishedAt`, then `id`).

```json
{
  "items": [
    {
      "id": "uuid",
      "color": "WHITE",
      "opponent": { "id": "uuid", "username": "rival", "avatarUrl": null, "elo": 1216, "color": "BLACK" },
      "outcome": "WIN",
      "reason": "CHECKMATE",
      "timeControl": { "initialTime": 600000, "increment": 0 },
      "moveCount": 7,
      "startedAt": "2026-10-27T10:00:00.000Z",
      "endedAt": "2026-10-27T10:05:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

- `outcome` is seen from the requested player. A bot opponent has `elo: null` and
  `botDifficulty`, as in `GET /games/:id`.
- Paging reuses `PaginationQueryDto` (limit 1 to 100, offset 0 or more) and the
  `PaginatedResponse` type of `common/types/api.ts`. A bad value answers 400, an unknown
  user 404 `USER_NOT_FOUND`.
- Only public fields of the opponent are read; email and secrets never leave the server.

Files: `games/game-history.service.ts`, `games/game-history.controller.ts`,
`test/game-history.e2e-spec.ts`.

## Pages

- `/history` (signed in): ten games per page, with the result, the opponent and their
  rating, the colour, the reason, the time control, the number of moves and the date.
  `?page=` keeps the place, so Back and a reload work. A page past the end goes to the
  last one.
- `/replay/:id` (public): `GET /games/:id` and `GET /games/:id/moves`. The board shows the
  `fen` the server stored after each move, from the standard start position. Buttons,
  the move list and the arrow, Home and End keys move through the game; the result is
  drawn on the final position. A seated player sees their own side and "You won". An
  unfinished game links to the live page.
- The live game page links to the replay once the game is over.

Shared helpers in `shared/chess/game-text.ts` (end reasons, result text, bot name, move
rows) replace the copies that the board and the game page had.
