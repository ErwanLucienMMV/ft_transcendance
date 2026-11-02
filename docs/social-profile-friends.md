# Profiles, player search, friends and presence

Jira: FRONT-SOCIAL-01, 02, 03, 08, 09 (SCRUM-335, 336, 337, 342, 343) and FTEST-03 (SCRUM-457).
Friend requests (SOCIAL-04 to 07) follow once the request API is merged; the challenge button
(SOCIAL-10) needs an invitation the opponent can accept, which no backend offers yet.

## Pages

| Route | Access | Content |
|---|---|---|
| `/players/:id` | public | avatar or initial, username, presence, Elo, games played, last 10 rating changes and last 5 finished games (each opens its replay). The owner also sees won, drawn and lost games and links to `/history` and `/session` |
| `/friends` | signed in | player search (kept in `?q=`, so a reload or Back keeps it) and the friend list with live presence |

The session page links to the signed-in user's profile, and the navigation has a Friends link.

## APIs used (all already in `dev_test`)

| Call | Used for |
|---|---|
| `GET /v1/users/:id` | public profile, `online` boolean |
| `GET /v1/users/me` (`SessionLifecycle.refreshUser`) | the owner's win, draw and loss counts |
| `GET /v1/users/search?q=` | case-insensitive username search |
| `GET /v1/users/:id/rating-history` | rating changes, newest first |
| `GET /v1/users/:id/games` | recent finished games (lot 22) |
| `GET /v1/friends` | friends with `ONLINE`, `IN_GAME` or `OFFLINE` |
| WebSocket `USER_ONLINE`, `USER_OFFLINE`, `USER_STATUS_CHANGED` | live presence of friends (spec §29) |

`features/social/users-api.ts` holds the REST calls and `presenceChanges()`, which keeps only
well-formed presence events. `shared/presence-badge.ts` shows a dot and a word, so the state
never depends on colour alone.

## Presence needs a socket

The server counts a user as online while one of their tabs holds an authenticated WebSocket.
The application therefore opens the shared socket as soon as someone is signed in (`App`), not
only on game pages; signing out closes it as before. Without this, a player browsing the site
would look offline to their friends.

## Tests

- Unit: `users-api.spec.ts`, `profile-page.spec.ts`, `friends-page.spec.ts`, `app.spec.ts`
  (socket opened on sign-in). One test checks that refreshing the owner's counters does not
  reload the profile again (it used to loop).
- Browser: `e2e/social.e2e.ts` searches a second user, sees them online, opens the profile,
  sees them offline after they sign out, opens the own profile and reads a profile signed out.
