# Matchmaking on the play page

Jira: FRONT-MATCH-01 to 07 (SCRUM-374 to 380) and FTEST-09 (SCRUM-463).
Needs the matchmaking API of PR #68 (which contains PR #64); this lot merges that branch, so its
PR goes after them.

## Behaviour

The play page gets a first card, **Find an opponent**, next to "Play a friend" and "Play the
computer". It uses the same time control choice.

1. **Find an opponent** sends `POST /v1/matchmaking/join { timeControl }`.
2. While waiting, the card reads "Searching for a 10 + 0 opponent · 0:42" (time since the
   server queued the player), the other buttons and the time control are disabled, and
   **Cancel search** sends `POST /v1/matchmaking/leave`.
3. `MATCH_FOUND { gameId, color, opponentId }` on the signed-in socket opens `/game/:gameId`,
   where the existing game page joins the room.
4. Each join holds a 30 s lease (PR #76) that only `POST /v1/matchmaking/heartbeat` renews.
   While waiting, the page sends a heartbeat every 5 s (`MATCHMAKING_HEARTBEAT_MS`). Its reply
   is the queue status, so it also covers a missed MATCH_FOUND (NOTIFY has no replay): `MATCHED`
   opens the game, and `CANCELLED` means the lease ran out, so the card shows "The search
   expired. Start a new one." Heartbeats stop on cancel, on a match and when the page closes.
5. A cancel that loses the race to a committed match gets `MATCHED` back and opens that game.
6. After a reload, a search still `WAITING` resumes with its real waiting time; a `MATCHED`
   status reopens the game only if it is still `ACTIVE` (the status keeps the last game after
   it ends).
7. Leaving the page while waiting leaves the queue, so nobody is paired while away. Leaving
   while the join is still pending also leaves, and leaves again when the join's reply lands,
   in case the join was committed after the first leave; nothing keeps running afterwards.
8. `ACTIVE_GAME_EXISTS` becomes "You already have a game in progress. Finish it before looking
   for another." `ALREADY_IN_QUEUE` resumes the existing search.

Code: `features/game/matchmaking.ts` (`MatchmakingApi`, and `MatchmakingSearch`, provided by
the play page so the search ends with it), `play-page.*`.

## Differences from the spec, to settle with the backend

- Spec §24 leaves with `DELETE /matchmaking/leave`; PR #68 uses `POST /v1/matchmaking/leave`.
- Spec error codes `MATCHMAKING_ALREADY_QUEUED` and `MATCHMAKING_NOT_FOUND`; PR #68 answers
  `ALREADY_IN_QUEUE` and `ACTIVE_GAME_EXISTS`.
- `GET /v1/matchmaking/status` is not in the spec; the page relies on it for recovery.

## Tests

- Unit (`play-page.spec.ts`): join with the chosen control and the waiting display, controls
  locked while queued, MATCH_FOUND opens the game and does not leave the queue, cancel and the
  cancel-versus-match race, heartbeats while waiting (and only then), recovery and expiry through
  the heartbeat, resume after reload (waiting, finished match, active match), leaving on destroy,
  including during a pending join, and the active-game refusal.
- Browser (`e2e/matchmaking.e2e.ts`): one player cancels a search, then two players queue with
  15 + 10, both land on the same game with opposite colours, one resigns, and returning to
  the play page does not reopen the finished match.
