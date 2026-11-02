# Chessboard component (lot 17)

Jira: FRONT-CHESS-01 to 12 (SCRUM-345 to 356) and FTEST-07 (SCRUM-461).

## Files

| File | Role |
|---|---|
| `srcs/angular/42chess/src/app/shared/chess/chess-rules.ts` | FEN parsing/writing, legal move list, check, checkmate and stalemate detection |
| `srcs/angular/42chess/src/app/shared/chess/chess-board.ts` | `<app-chess-board>` component |
| `srcs/angular/42chess/src/app/features/board/board-page.ts` | `/board`, a local analysis board that shows the component |

## Authority

The spec keeps the server authoritative for legal moves and results. The client rules
only decide what the board highlights and offers. The board never plays a move itself:
it emits `moved`, the parent sends `MAKE_MOVE`, and the board changes only when the
parent passes the FEN confirmed by the server (`GAME_STATE` / `MOVE_PLAYED`). A move the
server rejects therefore leaves the board unchanged. The rules are checked against the
reference perft counts of five positions (castling, en passant, promotion, pins).

## Inputs and output

| Name | Type | Use |
|---|---|---|
| `fen` (required) | `string` | Position to draw; an invalid FEN shows an error instead of a board |
| `orientation` | `'WHITE' \| 'BLACK'` | Side shown at the bottom |
| `lastMove` | `{ from, to } \| null` | Highlighted squares |
| `interactive` | `boolean` | Off by default: spectators, replays and history stay read-only |
| `playerColor` | `'WHITE' \| 'BLACK' \| null` | Colour this viewer may move; `null` lets the side to move play |
| `result` | `{ winner, reason } \| null` | Server result; replaces the locally detected checkmate/stalemate |
| `moved` (output) | `{ from, to, promotion }` | `promotion` uses the WebSocket names (`QUEEN`, `ROOK`, `BISHOP`, `KNIGHT`) |

`BoardMove` matches `GameRealtime.move(from, to, promotion)`, so the game page (lot 18)
can forward it as is. Moves are made by click or drag and drop; Escape cancels a
selection or the promotion choice.
