# Puzzle contracts, FEN and reference data

The domain types in `puzzles/puzzle.types.ts` follow Proposition spec.md §30–33.
Persistence stays separate: `puzzles.solution` retains the existing UCI array;
`solutionMoves` records full `ChessMove` objects with from/to, optional promotion,
SAN notation, timestamp and playerId. Themes use the eight values in the spec.
`toPuzzle` produces the domain object. `toDailyPuzzleResponse` explicitly returns
only id/date/rating/fen/themes, never either solution representation.

## FEN standard

The primary reference is Steven J. Edwards' [Portable Game Notation Specification
and Implementation Guide, §16.1](https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm#c16.1).
A complete FEN is one line with six fields separated by single ASCII spaces:

1. Eight ranks from rank 8 to rank 1, files a to h; piece letters are case-sensitive.
   Digits 1–8 encode runs of empty squares, `/` separates ranks.
2. Active color: `w` or `b`.
3. Castling availability, in `KQkq` order, or `-`.
4. En passant target square, or `-`.
5. Halfmove clock: nonnegative integer.
6. Fullmove number: positive integer, incremented after Black's move.

The en passant target may be present even when no capture is available. Four-field
position descriptions omit the counters and are not accepted as complete FEN.
`assertFen` validates syntax and rank widths. It does not prove that the position
is legal or historically reachable. The existing C++ engine validates playable
positions and solution moves. No client-submitted success flag is trusted.
`validatePuzzle` checks the complete FEN, engine-confirmed moves and their SAN,
valid metadata, themes, and a checkmate ending for mate-tagged solutions.

## Development fixtures

These are original composed positions, not claims about historical games:

| Side | Complete FEN | UCI solution | SAN |
| --- | --- | --- | --- |
| White | `7k/5Q2/6K1/8/8/8/8/8 w - - 0 1` | `f7g7` | `Qg7#` |
| Black | `8/8/8/8/8/6k1/5q2/7K b - - 0 1` | `f2g2` | `Qg2#` |

Both have CHECKMATE and MATE_IN_ONE themes. The structured moves use the seeded
Alice/Bob UUIDs and a fixed fixture timestamp. Those are explicitly synthetic
test annotations, not recovered historical move metadata. Engine integration
tests verify both positions, moves, notation, and final checkmate.

## External reference: Lichess

[Lichess's official puzzle database documentation](https://database.lichess.org/#puzzles)
provides CC0 puzzle data, ratings, themes and UCI moves. No external service is
required at runtime and no bulk dataset is added to this repository.

Its CSV convention matters: the FEN is **before the opponent's setup move**.
Apply the first UCI move, then present the resulting position; the remaining
moves are the solution. Map theme names explicitly to our spec's enum. Lichess
UCI exports do not provide the timestamp/playerId required by our ChessMove
contract; importing them must preserve real provenance or use explicitly defined
annotation semantics. Do not fabricate historical player IDs or timestamps.

The engine regression test replays the documented `00sHx` sample:

```text
FEN: q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17
Setup: e8d7
Solution after setup: a2e6 d7d8 f7f8
```

The test confirms that the setup is legal, the prepared position has White to
move, every resulting FEN is complete, and the final position is checkmate.
The sample is a reference test, not an imported development puzzle record.

## Existing data and migration

`1792000000010-AlignSpecContracts.ts` adds fields without replacing old data.
Historical themes, structured solution details, attempts and duration remain
NULL where they were not recorded. The projections fail explicitly when those
required values are unknown. An operator must supply an accurate backfill before
serving those legacy records through the new domain projections. Seed reruns
remain insert-only and do not overwrite old fixture rows.

Attempt duration uses milliseconds, consistent with this application's other
durations; the draft does not explicitly prescribe a unit. A completed attempt
records its number of tries and elapsed duration separately from its move array.
No solving endpoint or attempt timer is implemented by these persistence tickets.

Run `npm run test:contracts`, `npm test`, `npm run test:db` and `npm run test:e2e` with the isolated test
services described in [DATABASE.md](DATABASE.md).

`test:contracts` checks projections against interface excerpts from the provided
spec using `tsconfig.contracts.json`. This additional check leaves all existing
unit, database and HTTP test configurations and scripts active.
