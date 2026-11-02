# API request examples

SCRUM-521 · Examples target the shipped Nginx/proxy routes on `dev_test`.
Use a test account and replace placeholders. These examples create accounts,
games, messages or queue entries when executed; they are not a read-only probe.

Set the public base in your shell:

```sh
API_BASE=https://localhost:8080/api
```

The local certificate is self-signed. For local examples only, add `-k` to curl;
use normal certificate validation on a public deployment.

## Health, registration and session

```sh
curl --fail-with-body "$API_BASE/v1/health"
# Expected: {"status":"ok"}

curl --fail-with-body "$API_BASE/v1/auth/register" \
  -H 'Content-Type: application/json' \
  --data '{"username":"example_player","email":"you@your-domain.tld","password":"replace-with-a-strong-password"}'
# 201; verify the email link before logging in.

curl --fail-with-body "$API_BASE/v1/auth/verify-email" \
  -H 'Content-Type: application/json' \
  --data '{"token":"<token-from-verification-link>"}'

curl --fail-with-body -c /tmp/chess-example-cookies.txt \
  "$API_BASE/v1/auth/login" -H 'Content-Type: application/json' \
  --data '{"login":"example_player","password":"replace-with-a-strong-password"}'
```

A successful login returns `accessToken` and public user data. A 2FA-enabled
account instead returns `requires2fa` and `challengeToken`; complete it with
POST `/v1/auth/2fa/verify`, body `{ "challengeToken": "...", "code": "123456" }`.
Save the refresh cookie from that response too. Copy the access token privately:

```sh
ACCESS_TOKEN='<access-token-from-successful-login>'
curl --fail-with-body "$API_BASE/v1/users/me" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

curl --fail-with-body -X POST -b /tmp/chess-example-cookies.txt \
  -c /tmp/chess-example-cookies.txt -H 'X-Session-Refresh: 1' \
  "$API_BASE/v1/auth/refresh"
# 200 with renewed access token, or 204 when no valid session remains.
```

The cookie jar contains a session secret. Keep it private and remove it when
finished. Do not paste passwords or tokens into issue reports.

## Profile and social

```sh
curl --fail-with-body "$API_BASE/v1/users/search?q=player&limit=20&offset=0"

curl --fail-with-body -X PATCH "$API_BASE/v1/users/me" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  --data '{"preferences":{"language":"fr","theme":"dark","soundEnabled":true}}'

PEER_ID='<other-user-uuid>'
curl --fail-with-body "$API_BASE/v1/friends/requests" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  --data "{\"recipientId\":\"$PEER_ID\"}"

curl --fail-with-body "$API_BASE/v1/friends/requests" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Accept as the **recipient**, using their token and the returned request UUID:

```sh
REQUEST_ID='<request-uuid>'
RECIPIENT_TOKEN='<recipient-access-token>'
curl --fail-with-body -X POST \
  "$API_BASE/v1/friends/requests/$REQUEST_ID/accept" \
  -H "Authorization: Bearer $RECIPIENT_TOKEN"
```

## Game and matchmaking

```sh
curl --fail-with-body "$API_BASE/v1/games" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  --data '{"opponentId":null,"timeControl":{"initialTime":300000,"increment":2000}}'
# 201: {"gameId":"<uuid>","status":"WAITING"}

GAME_ID='<gameId-from-create>'
curl --fail-with-body "$API_BASE/v1/games/$GAME_ID"
curl --fail-with-body "$API_BASE/v1/games/$GAME_ID/moves"

curl --fail-with-body "$API_BASE/v1/matchmaking/join" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  --data '{"timeControl":{"initialTime":300000,"increment":2000}}'
curl --fail-with-body -X POST "$API_BASE/v1/matchmaking/leave" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Times are milliseconds. Inviting a specific friend uses their UUID as
opponentId. Human chess actions use the authenticated WebSocket, not a generic
REST move endpoint.

## Private history and puzzle play

```sh
curl --fail-with-body "$API_BASE/v1/conversations" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
curl --fail-with-body "$API_BASE/v1/conversations/$PEER_ID/messages?limit=20&offset=0" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

curl --fail-with-body "$API_BASE/v1/puzzles/daily"
PUZZLE_ID='<id-from-daily-puzzle>'
curl --fail-with-body "$API_BASE/v1/puzzles/$PUZZLE_ID/attempts" \
  -X POST -H "Authorization: Bearer $ACCESS_TOKEN"
```

Submit a move chosen from that puzzle's actual board (the squares below show
the request shape, not a promised correct solution):

```sh
curl --fail-with-body "$API_BASE/v1/puzzles/$PUZZLE_ID/move" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  --data '{"from":"e2","to":"e4"}'
```

## Browser WebSocket example

Run in the browser console on the application origin with your test account:

```js
const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
socket.addEventListener('message', ({ data }) => console.log(JSON.parse(data)));
socket.addEventListener('open', () => socket.send(JSON.stringify({
  event: 'AUTHENTICATE', data: { accessToken: '<access-token>' }
})));
// After AUTHENTICATED, join a game the account is allowed to join:
socket.send(JSON.stringify({ event: 'JOIN_GAME', data: { gameId: '<game-uuid>' } }));
// After GAME_STATE, a legal move from the current player's position:
socket.send(JSON.stringify({ event: 'MAKE_MOVE', data: { gameId: '<game-uuid>', from: 'e2', to: 'e4' } }));
```

Wait for each acknowledgement/state before running the next command. Actor IDs,
clocks and FEN are never supplied. Reconnect by authenticating and joining again;
do not replay a previous mutation automatically.

## Error and logout

A PATCH profile body `{ "elo": 9999 }` is rejected with HTTP 400 and
`VALIDATION_ERROR`; ratings are server-owned. A protected request without a
valid bearer is rejected; malformed UUIDs return 400. Handle the actual public
`code` in `{ statusCode, code, message }` rather than matching message prose.

```sh
curl --fail-with-body -X POST "$API_BASE/v1/auth/logout" \
  -b /tmp/chess-example-cookies.txt -c /tmp/chess-example-cookies.txt \
  -H "Authorization: Bearer $ACCESS_TOKEN"
# 204; this revokes the session used above.
```

Sources: [auth controller](../srcs/nestJS/42chess/src/auth/auth.controller.ts),
[session controller](../srcs/nestJS/42chess/src/auth/session.controller.ts),
[game DTO](../srcs/nestJS/42chess/src/games/dto/create-game.dto.ts),
[puzzle controller](../srcs/nestJS/42chess/src/puzzles/puzzles.controller.ts),
[realtime contract](../srcs/nestJS/42chess/README.md).
