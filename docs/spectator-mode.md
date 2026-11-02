# Spectator mode (lot 23)

Jira: SPEC-01 to 10 (SCRUM-268 to 277), FRONT-SPEC-01 to 08 (SCRUM-391 to 398),
E2E-12 (SCRUM-477) and SEC-06 (SCRUM-487).

## Realtime

| Client → server | Effect |
|---|---|
| `START_SPECTATING {gameId}` | Any signed-in user enters the game room read-only. The server answers with `GAME_STATE`, then sends `MOVE_PLAYED`, `CLOCK_UPDATE`, draw events and `GAME_ENDED` like to the players. A game that has not started answers `ERROR GAME_NOT_ACTIVE`. A finished game sends its state and `GAME_ENDED`. |
| `STOP_SPECTATING {gameId}` | Leaves the room; the server answers `GAME_LEFT`, as for `LEAVE_GAME`. |

- A spectator connection can never act: `MAKE_MOVE`, `RESIGN`, `OFFER_DRAW`,
  `ACCEPT_DRAW` and `DECLINE_DRAW` answer `ERROR SPECTATOR_READ_ONLY` before reaching the
  game service, even when the account is seated in that game. `JOIN_GAME` from a seated
  account turns the connection into a player connection.
- `GAME_STATE` now carries `spectatorCount`: distinct users watching (two tabs count once).
  When it changes, the room receives a new `GAME_STATE`; nothing else is resent.
- Rooms, and so the counts, live in the memory of one API process, like the existing
  player rooms. Several API replicas would need a shared store.
- No new server event name: the spec list (§14.2) is unchanged.

## REST

`GET /api/v1/games/live` (public, spec §28): up to 50 `ACTIVE` games, the most recently
started first.

```json
{ "games": [ { "id": "uuid", "whitePlayer": {}, "blackPlayer": {}, "spectatorCount": 2,
  "timeControl": { "initialTime": 180000, "increment": 2000 }, "startedAt": "..." } ] }
```

`timeControl` and `startedAt` are additions to the spec shape. Players use the same
public fields as `GET /games/:id`.

Files: `games/live-games.service.ts`, `games/spectator-registry.ts` (counts shared between
the realtime rooms and the REST list), `games/player-ref.ts` (seat to public player, also
used by the history), `realtime/game-realtime.service.ts`.

## Pages

- `/live` (public, linked in the menu): the games in progress with both players, the time
  control and the spectators; refreshed every 15 seconds and on demand. **Watch** opens
  `/game/:id?watch=1`; a player of a listed game gets **Back to your game** instead.
- `/game/:id` as a spectator: "Spectating", whose turn it is, clocks, moves and the end of
  the game in real time, no move, resign or draw control, and **Stop watching**. Someone
  without a seat who opens a game link is moved to spectating automatically (this replaces
  the read-only REST fallback of lot 19). Players also see how many people watch.
- The transport restores a spectator room as a spectator after a reconnect.

## Tests

- Unit: `realtime/game-realtime.service.spec.ts` (spectator rules, counts, late joiners).
- Backend e2e: `test/game-realtime.e2e-spec.ts` (two spectators, every refused command,
  `GET /games/live`, disconnect).
- Browser: `e2e/spectator.e2e.ts` (three browsers).
