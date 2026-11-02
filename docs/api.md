# API reference

SCRUM-512 · Routes below are relative to `/api` through production Nginx or the
Angular development proxy. Direct NestJS requests omit `/api`. Example public
base: `https://localhost:8080/api`. This describes the controllers on `dev_test`
at `062aaa6`.

## Common contract

JSON request bodies use `Content-Type: application/json`. Protected endpoints
require `Authorization: Bearer <accessToken>`. Authentication determines the
actor; never send `userId`, `senderId`, Elo, clocks or board state to impersonate
one. Unknown DTO properties are rejected with a validation error. UUID path
parameters and nested DTOs are validated before domain mutations.

Public errors use `{ statusCode, code, message }` and may include validation
details. Handle `code` rather than matching translated prose. HTTP 400 means
invalid input; 401 missing/expired credentials; 403 denied action; 404 absent
resource; 409 a domain conflict; 503 unavailable dependency/configuration.
Successful status codes below describe ordinary responses, not all errors.

Pagination where supported uses `limit` (1–100, default 20) and `offset`
(non-negative integer, default 0). User search additionally accepts `q`.
Times are UTC ISO strings; game clock balances and time controls are milliseconds.

## Authentication and OAuth

| Method and route | Input | Success / access |
| --- | --- | --- |
| POST `/v1/auth/register` | `{ username, email, password }` | 201, unverified user; sends verification email |
| POST `/v1/auth/verify-email` | `{ token }` | 200, verified user |
| POST `/v1/auth/resend-verification` | `{ email }` | 202 regardless of pending account existence |
| POST `/v1/auth/login` | `{ login, password }` | 200, session or 2FA challenge |
| POST `/v1/auth/2fa/verify` | `{ challengeToken, code }` | 200, session after TOTP verification |
| POST `/v1/auth/refresh` | Refresh cookie and `X-Session-Refresh: 1` | 200 renewed session, or 204 when no valid session remains |
| POST `/v1/auth/logout` | Refresh cookie | 204, revokes session and clears cookie |
| GET `/v1/auth/oauth/providers` | none | Enabled provider names |
| GET `/v1/auth/oauth/:provider` | google or github | Redirects browser to provider |
| GET `/v1/auth/oauth/:provider/callback` | Provider query and flow cookie | Provider callback; browser flow only |
| POST `/v1/auth/oauth/exchange` | Browser-bound handoff cookies; `X-OAuth-Exchange: 1` | 200, exchanges one-use handoff for session |
| GET `/v1/auth/oauth/accounts` | Bearer | Linked providers |
| POST `/v1/auth/oauth/:provider/link` | Bearer | Starts authenticated linking flow |
| DELETE `/v1/auth/oauth/:provider` | Bearer | Unlinks subject to retaining a usable sign-in method |

`login` accepts username or email. A 2FA challenge has `requires2fa` and
`challengeToken`; it is not an access token. Sessions return an access token and
public user information; refresh secrets are carried in an httpOnly cookie,
not JSON. Browser clients use credentials for refresh/logout and the required
header when renewing. OAuth state,
PKCE verifier, provider tokens and application secrets remain server-side.

## Users and social

| Method and route | Input / access | Behavior |
| --- | --- | --- |
| GET `/v1/users/me` | Bearer | Current private profile |
| PATCH `/v1/users/me` | Bearer; `{ username?, avatarUrl?, preferences? }` | Update only caller-owned editable profile fields |
| GET `/v1/users/search` | `q`, `limit`, `offset` | Public user search |
| GET `/v1/users/:id` | UUID | Public profile |
| GET `/v1/users/:id/games` | UUID, pagination | Public game history |
| GET `/v1/friends` | Bearer | Caller friendships |
| GET `/v1/friends/requests` | Bearer | Incoming pending requests |
| POST `/v1/friends/requests` | Bearer; `{ recipientId }` | Send request |
| POST `/v1/friends/requests/:requestId/accept` | Bearer | Recipient accepts |
| POST `/v1/friends/requests/:requestId/reject` | Bearer | Recipient rejects |
| DELETE `/v1/friends/:friendId` | Bearer | Remove caller's friendship |

Preferences include supported theme, language, sound and board settings; see
[UpdatePreferencesDto](../srcs/nestJS/42chess/src/users/dto/update-preferences.dto.ts)
for the exact allowlist. Profile updates reject server-owned rating/security
properties, including nested injection. `avatarUrl: null` clears the avatar.

## Games, bots and matchmaking

| Method and route | Input / access | Behavior |
| --- | --- | --- |
| POST `/v1/games` | Bearer; `{ opponentId?, timeControl: { initialTime, increment } }` | 201 `{ gameId }`, waiting game; optional invited opponent |
| GET `/v1/games/live` | Public | Active game list |
| GET `/v1/games/:id` | Public UUID | Board, seats, clocks and terminal result |
| GET `/v1/games/:id/moves` | Public UUID | Ordered persisted SAN move history |
| POST `/v1/games/bot` | Bearer; `{ difficulty, timeControl }` | Computer game; EASY, MEDIUM or HARD |
| POST `/v1/games/:id/bot-move` | Bearer | Resume pending computer reply |
| POST `/v1/games/:id/bot/player-move` | Bearer; `{ uci }` | Human UCI move in own bot game |
| POST `/v1/matchmaking/join` | Bearer; `{ timeControl }` | Enter queue or return match |
| GET `/v1/matchmaking/status` | Bearer | Caller queue/match state |
| POST `/v1/matchmaking/heartbeat` | Bearer | Refresh queue liveness |
| POST `/v1/matchmaking/leave` | Bearer | Leave queue |

Human game moves, resignation and draw offers use WebSockets. Public game
reads support spectating; this does not grant mutation permission. Invitations
reserve the second seat, while clocks, legality and Elo are server-controlled.

## Chat and puzzles

| Method and route | Input / access | Behavior |
| --- | --- | --- |
| GET `/v1/conversations` | Bearer | Actor-scoped private conversation summaries |
| GET `/v1/conversations/:userId/messages` | Bearer; peer UUID, pagination | Caller's history with peer |
| GET `/v1/games/:id/messages` | Bearer; UUID, pagination | Game chat history with access checks |
| GET `/v1/puzzles/daily` | Public | Daily puzzle metadata without future solution |
| POST `/v1/puzzles/:id/attempts` | Bearer; puzzle UUID | Start/resume owned attempt |
| GET `/v1/puzzles/attempts/:id` | Bearer; attempt UUID | Caller-owned attempt state |
| POST `/v1/puzzles/:id/move` | Bearer; `{ from, to, promotion? }` | Play on latest unfinished attempt; 200 |
| POST `/v1/puzzles/attempts/:id/moves` | Bearer; `{ move, version }` | Versioned UCI attempt move; 200 |

Square moves use lowercase `a1`–`h8`; optional promotion is QUEEN, ROOK,
BISHOP or KNIGHT. UCI promotion uses the lowercase suffix. Future puzzle moves
remain private; accepted player moves and an immediate opponent reply can be
returned. Private sends and game chat sends use realtime events rather than a
REST send endpoint.

## WebSocket and health

Connect to `/ws` on the public origin with `wss:` in production. First send:

```json
{ "event": "AUTHENTICATE", "data": { "accessToken": "<access token>" } }
```

Wait for `AUTHENTICATED` before commands. Game events include JOIN_GAME,
LEAVE_GAME, MAKE_MOVE, RESIGN, OFFER_DRAW, ACCEPT_DRAW and DECLINE_DRAW.
MAKE_MOVE uses `{ gameId, from, to, promotion? }`; other commands carry gameId.
Server state/move/clock/result events are authoritative. An ERROR event contains
the structured public error. Disconnects require reauthentication and fresh
room state; never blindly replay a mutation.

Transport details and additional chat/spectator contracts are documented in
[the backend realtime contract](../srcs/nestJS/42chess/README.md),
[private messaging](private-messaging.md), [game chat](game-chat.md) and
[spectator mode](spectator-mode.md). Incoming frames are limited to 16 KiB.

`GET /v1/health` is available directly, or `/api/v1/health` through Nginx.
Operational metrics and Grafana are separate from the business API.

Source controllers: [auth](../srcs/nestJS/42chess/src/auth/auth.controller.ts),
[session](../srcs/nestJS/42chess/src/auth/session.controller.ts),
[OAuth](../srcs/nestJS/42chess/src/oauth/oauth.controller.ts),
[users](../srcs/nestJS/42chess/src/users/users.controller.ts),
[friends](../srcs/nestJS/42chess/src/friends/friends.controller.ts),
[games](../srcs/nestJS/42chess/src/games/games.controller.ts),
[puzzles](../srcs/nestJS/42chess/src/puzzles/puzzles.controller.ts).
