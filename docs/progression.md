# Statistics, progression and achievements

What players earn and how they compare: the leaderboard, public statistics on every profile,
experience (XP) and levels, the daily puzzle streak, achievements, and the puzzle rules that
keep rewards fair (limited tries, hints, revealed solutions, archive). API routes are given as
NestJS sees them (`/v1/...`); behind Nginx they start with `/api/v1`.

The numbers live in one place, `XP_RULES` in
`srcs/nestJS/42chess/src/progression/progression.rules.ts`. The API serves them at
`GET /v1/progression/rules` and the **How progression works** page (`/progression`) reads them
from there, so the page and the awards cannot disagree.

## Leaderboard and statistics

| Route (public) | Response |
| --- | --- |
| `GET /v1/leaderboard?limit=&offset=` | `{ total, items: [{ rank, id, username, avatarUrl, elo, gamesPlayed, gamesWon, gamesDraw, gamesLost, level }] }` |
| `GET /v1/users/:id/stats` | `{ rank, rankedPlayers, rated, casual, bots, progression, puzzles }` |
| `GET /v1/users/:id/achievements` | `{ achievements: [{ code, name, description, goal, xp, progress, unlockedAt }] }` |
| `GET /v1/progression/rules` | `{ xp, levels, achievements }` |

- The leaderboard ranks verified accounts with at least one rated game, best rating first.
  Equal ratings share a rank (`RANK()`); ties are listed by games played, then name. Pages are
  at most 100 rows (`400 VALIDATION_ERROR` above).
- `rank` is `null` until the player has a rated game. `rated` comes from the counters the
  rating service keeps; `casual` (human games that were not rated) and `bots` (games against
  the computer) are counted from finished games with a result. Aborted games count nowhere.
- `progression` is `{ xp, level, levelXp, nextLevelXp }`; `puzzles` is
  `{ solved, streak, bestStreak, solvedToday }`, where `solved` counts puzzles that earned XP
  and `streak` is 0 once a day was missed.
- An unknown or unverified account answers `404 USER_NOT_FOUND`, like the public profile.

Front:

- **Leaderboard** in the main navigation (`/leaderboard`): 25 rows per page, the signed-in
  player's row marked ("you", `aria-current`), and **Show my rank** when that row is on
  another page. `?rank=n` opens the page that holds rank n (the profile links there).
- Every profile shows rating, rank, level and puzzle streak; a results table (rated, casual,
  computer); the level bar; a rating curve drawn from the last 100 rated games; and the
  achievements with their progress. `#progression` and `#achievements` anchor those sections.

## Experience and levels

| Source | XP |
| --- | --- |
| Game against a player (rated or casual): win, draw, loss | 30, 15, 10 |
| Game against the computer, win or draw: easy, medium, hard | 10/5, 20/10, 40/20 |
| Daily puzzle solved on its day | 20, plus the streak bonus |
| Puzzle from the archive | 10 |
| Streak bonus | 5 per day of streak, at most 35 (7 days) |
| Achievement | its own XP, shown in the list |

- A game counts once each side has made two moves (4 plies), so an instant resignation earns
  nothing. A loss against the computer earns nothing.
- A puzzle earns XP only when it is solved on the player's **first and only** attempt at it:
  starting it again makes the new attempt practice (`practice: true`), and the earlier one
  stops counting too. A hint halves the puzzle XP (rounded down); a revealed solution ends the
  attempt without XP.
- Level n needs 50 × n × (n − 1) XP in total: level 2 at 100, 3 at 300, 4 at 600, 5 at 1000.
  XP never goes down.

Every award is a row of `xp_events`, unique per `(userId, source, refId)` where `refId` is the
game id, the puzzle id or the achievement code. Running the finishing logic twice therefore
pays once. `user_progress` keeps the running total and the streak.

### Where awards happen

- Games: `GameStoreService.lockTransaction`, in the transaction that finishes the game, right
  after the rating update, for every human seat (users locked in id order). A failure rolls
  back the whole finish, as for ratings.
- Puzzles: `PuzzlesService.play`, in the transaction of the move that solves the puzzle. It
  takes the same advisory lock as `start`, so a second attempt and the solve of the first are
  serialized and "only attempt" is checked reliably.
- After commit, `ProgressionService.settle` unlocks achievements (each in its own small
  transaction) and sends `ACHIEVEMENT_UNLOCKED { code, name, description, goal, xp }` and
  `LEVEL_UP { level, xp }` to the player's open sockets. It never throws: the game or puzzle is
  already saved, and the next settlement unlocks anything missed.

Front: those events show a notice (bottom right, 10 s) with a link to the player's profile:
"Achievement unlocked: First victory…" or "Level up: You reached level 3."

## Daily puzzle streak

Solving the daily puzzle on its own UTC day, on the first attempt, adds a day: the streak goes
up when the previous counted day was yesterday, stays when it was today, and restarts at 1
otherwise. `bestPuzzleStreak` keeps the record. Puzzles from the archive never count for the
streak. The puzzle page shows the current streak, and the reward after a solve ("+35 XP ·
3-day streak").

## Achievements

Seeded by the `AddProgression` migration in `achievements` (code, position, name, description,
metric, goal, xp); `user_achievements` records `(userId, code, unlockedAt)`. Progress is computed
from durable data each time, so it is always consistent with history:

| Code | Name | Goal | XP |
| --- | --- | --- | --- |
| `FIRST_GAME` | Opening move | 1 game against a player | 10 |
| `FIRST_WIN` | First victory | 1 win against a player | 20 |
| `GAMES_10` | Regular | 10 games against players | 30 |
| `GAMES_50` | Veteran | 50 games against players | 75 |
| `WINS_25` | Conqueror | 25 wins against players | 75 |
| `BOT_EASY` | Warm-up | Beat the easy computer | 10 |
| `BOT_MEDIUM` | Sparring partner | Beat the medium computer | 25 |
| `BOT_HARD` | Machine slayer | Beat the hard computer | 50 |
| `PUZZLE_FIRST` | Puzzle solver | 1 puzzle solved on the first try | 10 |
| `PUZZLES_25` | Tactician | 25 puzzles solved on the first try | 50 |
| `STREAK_3` | On a roll | 3-day daily streak | 20 |
| `STREAK_7` | Week of tactics | 7-day daily streak | 50 |
| `RATING_1400` | Climber | Reach a rating of 1400 (peak counts) | 50 |
| `LEVEL_5` | Rising star | Reach level 5 | 0 |

Games count when they would earn XP (a result and two moves each). Achievements earned with
games played before this version unlock at the player's next finished game or puzzle.

## Puzzle rules

| Route | Behavior |
| --- | --- |
| `GET /v1/puzzles/daily` | Public. Assigns today's puzzle (unchanged) |
| `GET /v1/puzzles/:id` | Public. A puzzle that was the daily puzzle of today or an earlier day: `{ id, date, rating, fen, themes }`. Otherwise `404 PUZZLE_NOT_FOUND` |
| `GET /v1/puzzles/archive?limit=&offset=` | Bearer. Earlier days, newest first: `{ total, items: [{ date, id, rating, themes, status }] }`, `status` being `SOLVED`, `FAILED`, `STARTED` or `null` for this player |
| `GET /v1/puzzles/:id/progress` | Bearer. `{ attempt, rewarded }`: the latest attempt, to resume it on any device |
| `POST /v1/puzzles/:id/attempts` | Bearer. Only for a published puzzle (`404 PUZZLE_NOT_FOUND` for the rest of the catalogue and for future days) |
| `POST /v1/puzzles/attempts/:id/hint` | Bearer. `{ ...attempt, hint: "e2" }`, the square of the piece to move. Marks the attempt `hintUsed` |
| `POST /v1/puzzles/attempts/:id/solution` | Bearer. `{ ...attempt, solution: [UCI…] }`, the whole line from the published position. An unsolved attempt becomes `revealed` and ends |

- An attempt now reports `mistakes`, `mistakesLeft`, `failed`, `hintUsed`, `revealed` and
  `practice`. Three wrong moves end it: further moves, hints and the spec route on it answer
  `409 PUZZLE_ATTEMPT_FAILED`. `POST /v1/puzzles/:id/move` skips failed attempts and starts a
  new (practice) one.
- The solution still never reaches the browser unless the player asks for it, which ends the
  attempt without reward. Before this, the only limit on guessing was the player's patience.
- The move that solves a counted puzzle returns `reward: { xp, streak }` (`streak` is `null`
  for an archive puzzle).

Front (`/puzzle`, `/puzzle/:id`, `/puzzle/archive`):

- The page resumes the latest attempt from the server, so another device or tab continues
  where the player left off (this replaces the attempt id kept in `sessionStorage`).
- **Hint** outlines the piece to move on the board; **Show the solution** replays the line
  with previous and next buttons; **Try again** / **Solve it again** start a practice attempt.
  Tries left and the practice state are shown under the buttons.
- **Earlier puzzles** lists the archive with the player's status on each.

## Data and privacy

The data export includes `progression: { xp, puzzleStreak, bestPuzzleStreak, lastStreakDate,
experience, achievements }` and the new attempt fields. Account deletion removes
`user_progress`, `xp_events` and `user_achievements` rows (they also cascade if a user row is
ever deleted).

## Tests

- `src/progression/progression.rules.spec.ts`: levels and XP tables.
- `test/progression.e2e-spec.ts`: XP for both players after a real game, achievements and
  `LEVEL_UP` over WebSocket, idempotence, results by kind, rank, the computer, short games,
  the leaderboard, rules, 404s.
- `test/puzzle-progression.integration-spec.ts`: unpublished and future puzzles refused, the
  third mistake, the daily reward and streak, a missed day, hints, revealed solutions, the
  archive statuses, a second attempt racing the solve.
- `test/puzzles.e2e-spec.ts`: the new routes over HTTP. `test/account.e2e-spec.ts`: export and
  deletion.
- Front unit specs for the leaderboard, rules, archive and puzzle pages, the profile statistics,
  the rating chart and the notices; `e2e/progression.e2e.ts` plays a rated fool's mate between
  two browsers (notices, profile, leaderboard, rules) and uses a hint and the solution on the
  daily puzzle.
