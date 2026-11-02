# Playing against the computer

This page explains how the three computer levels choose their moves, and why.
The protocol, limits and deployment of the bot service are in
[srcs/bot/README.md](../srcs/bot/README.md).

## How the search works

The bot is a C++17 program of its own (`srcs/bot`), reached by NestJS over a
WebSocket. It never decides what is legal: move generation, special moves and
legality come from the same rules code as the game server
(`srcs/chess-engine/src/chess.cpp`), and NestJS checks the chosen move against
the rules service again before saving it.

- **Negamax.** A move's value for one side is minus its value for the other, so
  one recursive function scores both sides: the value of a position is the best,
  over its legal moves, of minus the value of the position after the move.
- **Alpha-beta pruning.** The search keeps the best score already guaranteed
  (alpha) and the score the opponent will not allow (beta). As soon as a move
  proves the position is too good to be allowed, the remaining moves of that
  node are skipped. With good move ordering this roughly squares the reachable
  depth for the same work.
- **Move ordering.** The previous best move (from the table below) is tried
  first, then promotions, then captures by "most valuable victim, least valuable
  attacker", then quiet moves.
- **Iterative deepening.** The bot searches depth 1, then 2, then 3, and so on
  until its budget of depth, nodes or time runs out. Each completed depth orders
  the next one, and if time runs out mid-iteration, the last completed one is
  used. A legal move is always available, even with no time at all.
- **Quiescence search.** At the end of the main depth, captures and promotions
  (all moves when in check) are followed for up to six more plies, so the bot
  does not stop in the middle of an exchange and think it won a piece.
- **Transposition table.** Positions already scored are remembered (16 MiB per
  search), keyed by position and by the repetition history that matters, so a
  draw by repetition is never confused with the same board reached safely.
- **Evaluation.** At the leaves, a position is scored in centipawns: material
  (pawn 100, knight 320, bishop 335, rook 500, queen 900), centralization of
  pieces, pawn advancement, the bishop pair, rooks on the seventh rank, king
  safety (castled king, pawn shield) in the middlegame and king activity in the
  endgame. Mates score about 30000, minus the distance, so a faster mate is
  preferred. Stalemate, insufficient material, the fifty-move rule and
  threefold repetition score 0.

## What was wrong

The first version of the bot always played the best move its search found, with
a fixed budget per level. That made it:

- **predictable**: the same position always got the same answer, so every game
  that started the same way went on the same way, and a player who beat it once
  could replay the winning game move for move;
- **a weak "easy" level that still never blundered**: EASY only searched one ply,
  so it missed simple tactics, but it never made the human-like mistakes a
  beginner can learn to punish;
- **instant**: the bot answered in a few milliseconds, which felt mechanical and
  gave no sense of a real opponent.

## How a level chooses a move

1. **Opening book.** While the game is in a known opening, the bot picks one of
   the usual replies, weighted by popularity (for example 1.e4 40%, 1.d4 35%,
   1.Nf3 15%, 1.c4 10% as White). Positions are matched by board, so a different
   move order that reaches a book position is recognized.
2. **Search.** Out of the book, the level searches as before (iterative
   deepening alpha-beta with quiescence), with its depth, node and time budget.
3. **Choice.** Instead of always taking the top move, the level picks among the
   moves whose score is within its margin of the best, the closer the likelier:

   | Level | Margin | Deliberate mistakes |
   | --- | --- | --- |
   | EASY | 80 centipawns | 15% of moves: any move up to 350 cp worse |
   | MEDIUM | 20 centipawns | none |
   | HARD | 0 (equal moves only, in random order) | none |

   A centipawn is a hundredth of a pawn. 20 cp is a nuance between two good
   moves; 350 cp is roughly a minor piece.

Two rules always win over variety:

- a forced mate, for or against the bot, is played exactly;
- a mistake is bounded by the margin, so EASY can drop a pawn or a knight but
  never leaves a free queen.

HARD keeps a zero margin because widening the window of the first ply costs it a
full ply of depth in quiet positions; it varies through the book and between
equally scored moves only.

## Think time

The bot shows a think time before each move, longer in busier positions and at
higher levels, varying by a quarter either way (EASY 0.5 to 1.5 s, MEDIUM 0.7 to
2.2 s, HARD 0.9 to 3 s; book moves and forced replies about 0.35 s). The search
time is part of it, and the pause never takes more than a fortieth of the bot's
remaining clock. The game page shows "The bot is thinking…" meanwhile.

## Testing

Randomness is seeded per request. Tests pass a fixed `seed` to replay the same
choices; the C++ suite checks over 24 seeds that EASY and MEDIUM play at least
two different moves in the same position, that the opening varies, and that the
tactical guarantees above hold for every seed. Computer games are never rated,
so this variety never touches Elo.
