# Matchmaking criteria (SCRUM-219 / MATCH-04)

The server matches persisted queue entries using the pure policy in
`srcs/nestJS/42chess/src/matchmaking/matchmaking.policy.ts`.

- Both entries must be `WAITING`, with different row IDs and different user IDs.
- `initialTime` and `increment` must each match exactly, in integer milliseconds.
  For example, `180000 + 2000` is a different queue from `180000 + 0`.
- Elo comes from `matchmaking_queue.rating`, populated from the authoritative
  `User.elo` by `MatchmakingService.join`. The join DTO does not accept a rating.
  This is the rating snapshot at join time, not a client claim.
- Each player's inclusive Elo tolerance starts at 100, increases by 50 after
  every complete 30 seconds of waiting, and stops at 400 after 180 seconds.
  Future creation timestamps receive the initial 100 tolerance (zero wait age).
- Compatibility is symmetric: the absolute Elo gap must fit **both** players'
  tolerances (`gap <= min(leftWindow, rightWindow)`). An older player therefore
  cannot force a newly queued player into a wider rating range.
- Among compatible candidates, use FIFO `createdAt ASC, id ASC`. UUID comparison
  is lexical on canonical PostgreSQL UUID strings. Elo proximity does not override
  FIFO. Rejoining resets `createdAt`, so a previous queue visit grants no priority.

`eloWindow(createdAt, now)` computes the tolerance. `areCompatible(left, right,
now)` checks eligibility, and `compareQueueOrder(left, right)` supplies the FIFO
comparator. All functions take server-owned data and do no I/O or mutation.
Callers must pass the same server timestamp to all checks in a selection pass.
Invalid dates throw `RangeError`; they must not silently produce a match.

Candidate selection can filter with `areCompatible` and sort with
`compareQueueOrder`. Database selection must retain the same eligibility and
order, then recheck and lock both entries transactionally before matching. This
policy alone does not claim entries, create games, or provide concurrency safety.
