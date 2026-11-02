# Daily puzzle page (lot 21)

Jira: FRONT-PUZZLE-01 to 09 (SCRUM-413 to 421), FTEST-11 (SCRUM-465), PUZZLE-06 checked
(SCRUM-308).

## Files

| File | Role |
|---|---|
| `srcs/angular/42chess/src/app/features/puzzle/puzzle-page.ts` | `/puzzle`, the daily puzzle |
| `srcs/angular/42chess/src/app/features/puzzle/puzzles-api.ts` | REST client and the attempt kept for the tab |
| `srcs/angular/42chess/e2e/puzzle.e2e.ts` | Real API: anonymous view, a judged move, resume after reload |

The backend is the one described in [puzzles/README.md](puzzles/README.md); nothing was
changed there.

## Flow

- `GET /api/v1/puzzles/daily` is public: anyone sees the position, the rating and the
  themes. Solving needs an account; the page offers to sign in and comes back.
- The first move creates the attempt (`POST /puzzles/:id/attempts`), so visiting the page
  creates nothing. Each move is sent as UCI with the current `version`.
- The move is drawn as a preview until the server answers. A correct move shows the
  opponent reply the server played (highlighted as the last move). A wrong move leaves
  the position unchanged and can be retried.
- When solved, the page shows the server-measured time and the wrong tries
  (`attempts` minus the solver's accepted moves), and can start a new attempt.
- `409` (another tab moved first, or the attempt is already finished) reloads the
  attempt from the server.

## Resume

The attempt id, the puzzle id and the user id are kept in this tab's `sessionStorage`, so
a reload resumes the same attempt. Nothing secret is stored: the server checks that the
attempt belongs to the signed-in account. Signing out removes the entry.

## PUZZLE-06: the solution never reaches the browser

Checked in the backend: `solution` is not selected by default on the entity, the daily
and attempt responses are built field by field, and `test/puzzles.e2e-spec.ts` asserts
that no response contains `solution` or the move list. The front end has no way to ask
for it.

## Catalogue

An empty catalogue answers `503 PUZZLE_CATALOG_EMPTY`; the page says no puzzle is
available. The browser e2e compose now imports the bundled catalogue before starting the
API. The main `docker-compose.yml` still needs the one-time import documented in
`docs/puzzles/README.md`.
