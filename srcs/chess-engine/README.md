# Chess engine

Standalone C++17 rules service, executable **`chess_engine`**, speaking RFC 6455
WebSocket with JSON text messages. It is not an installed C++ library and does
not pick an AI move. NestJS owns users, authorization, persistence and game
history; this process answers rules queries. Each request is independent, so
multiple matches and backend clients can share the same daemon.

## Run

From this directory, on Debian/Ubuntu:

```sh
sudo apt-get update
sudo apt-get install g++ cmake make libboost-dev nlohmann-json3-dev python3
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j2
ctest --test-dir build --output-on-failure
python3 tests/websocket_test.py build/chess_engine
./build/chess_engine --host 127.0.0.1 --port 8081
```

`make` and `make test` are also supported. Boost.Beast/Asio and nlohmann/json
come from system packages; no build-time source downloads or vendored libraries.
The Make build needs those headers, a C++17 compiler, and pthreads.

To run in the background locally:

```sh
./build/chess_engine >chess-engine.log 2>&1 &
engine_pid=$!
# Later:
kill "$engine_pid"
```

`CHESS_ENGINE_HOST` and `CHESS_ENGINE_PORT` set defaults, overridden by CLI
arguments. The native default is `127.0.0.1:8081`. SIGINT/SIGTERM stop the process
and close its sockets. No state is lost because the backend supplies history.

### Docker Compose

Both existing Compose files include `chess-engine` and set
`CHESS_ENGINE_URL=ws://chess-engine:8081` for NestJS. From `srcs/`:

```sh
docker compose up --build -d chess-engine
# Or the development stack:
docker compose -f docker-compose.dev.yml up --build -d chess-engine nestjs
```

Port 8081 is exposed **inside the Compose network only**, not published on the
host. The Docker image runs as a non-root user, binds `0.0.0.0`, and builds and
runs C++ and WebSocket tests before producing the runtime image. Compose keeps
it running with `restart: unless-stopped`. No startup dependency is needed:
NestJS opens the channel only when a query is made and returns a connection
error if the engine is unavailable; a later request opens a fresh connection.

## Wire protocol, version 1

Use plain WebSocket (`ws://`), **not Socket.IO**. One request gives one response
on the same connection. The connection may be reused. `id` is an optional string,
integer or null and is echoed for correlation. Responses are ordered per socket.

| Field | Meaning |
| --- | --- |
| `op` | Required: `ping`, `analyze`, `legal_moves`, `validate`, or `move` |
| `fen` | Optional **initial** position; defaults to the standard starting board |
| `moves` | Optional ordered array of UCI moves to replay from that initial position |
| `move` | Required candidate UCI move for `validate` or `move` |

UCI squares are lowercase: `e2e4`, `e1g1` (castle), `e5d6` (en passant).
Promotion **must** supply a lowercase suffix `q`, `r`, `b`, or `n`, e.g. `a7a8n`.
There is no implicit queen promotion.

```json
{"id":"game-42:7","op":"move","moves":["e2e4","e7e5"],"move":"g1f3"}
```

Success envelope:

```json
{"id":"game-42:7","ok":true,"result":{"fen":"rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2","turn":"black","check":false,"checkmate":false,"stalemate":false,"insufficientMaterial":false,"status":"ongoing","winner":null,"repetitionCount":1,"threefoldClaimable":false,"fiftyMoveClaimable":false,"legalMoves":["a7a6","a7a5"]}}
```

The `legalMoves` array above is abbreviated for readability. The real response
contains **all** legal moves for the resulting side to move.

- `ping` returns `{ "service": "chess_engine", "protocolVersion": 1 }`.
- `analyze` and `legal_moves` both return a snapshot with all legal moves.
- `validate` returns `{ "legal": true|false, "fen": "..." }` without applying
  the candidate. A syntactically valid but illegal candidate returns `ok:true`
  with `legal:false`; malformed input returns an error.
- `move` applies a legal candidate after replaying the supplied history and
  returns the resulting snapshot. It does not persist the move in the daemon.
- Snapshot `status` is `checkmate`, `stalemate`, `insufficient_material` or
  `ongoing`, in that precedence. `winner` is set only for checkmate.
- Any malformed request, invalid FEN, illegal history move or illegal `move`
  candidate returns `ok:false` without modifying any other request or match.

```json
{"id":"game-42:7","ok":false,"error":{"code":"invalid_request","message":"Illegal move: e2e5"}}
```

A malformed JSON payload has `id:null`; unexpected internal exceptions produce
`internal_error`. Unknown extra object fields are ignored for forward
compatibility. Binary messages close with code 1003; oversized messages with
1009. The service accepts at most 128 KiB per message, 2,048 history plies per
request and 256 simultaneous connections, with a 10-second handshake timeout
and 60-second idle timeout with keep-alive pings. Protocol processing is bounded
and serialized on one asynchronous event loop; this is a small internal rules
service, not a horizontally scaled public gateway.

### Repetition and draw semantics

**A FEN alone cannot encode repetition history.** Persist the initial FEN plus
all played UCI moves in NestJS, then send both on each request. Do not send the
current FEN alongside the history that already led to it: that would replay
moves twice. To analyze a single position, send only its FEN; its repetition
count starts at one.

Repetition identity includes piece placement, side to move, castling rights and
an en passant target **only if there is a legal en passant capture** (including
king-safety checks). Move clocks are excluded. Threefold is true from the third
occurrence; the 50-move claim is true at 100 plies without a pawn move or capture.
Both are **claimability flags**, not automatic game termination. To check a
claim based on an intended move, evaluate it with `op:"move"` before persisting
it. Backend game logic owns the claim, result storage and rejection of further
moves after an accepted result. Automatic fivefold/75-move draws are outside the
requested scope.

Insufficient material detects K v K, K+B v K, K+N v K, and bishop-only material
where every bishop occupies the same square color. K+NN v K and opposite-color
bishops are deliberately not classified as insufficient: inability to force a
mate is not the same as impossibility of any mating position. This is material
detection, not a general solver for every blocked-pawn dead position.

FEN imports validate six fields, board dimensions, exactly one king per color,
pawn ranks, side to move, castling prerequisites, en passant consistency,
unsigned clocks and that the inactive king is not in check. They do not prove
that every imported position is reachable from the standard starting position.
Clocks use saturating 64-bit counters. Use `initial()` or `fromFen()` to obtain
valid states; the public value types are also available to internal C++ tests.

## NestJS integration

`../nestJS/42chess/src/chess/chess-engine.service.ts` is already registered as a
provider in `AppModule`. Inject `ChessEngineService` into future controllers or
game services in that module:

```ts
constructor(private readonly engine: ChessEngineService) {}

// game.initialFen and game.moves come from backend storage.
const result = await this.engine.move('g1f3', {
  fen: game.initialFen,
  moves: game.moves,
});
// Persist the accepted move and result, then reply to the client.
```

The service uses Node 22's native WebSocket (matching this repository's Docker
images), typed snapshots, request IDs, a 10-second timeout and a fresh socket
per request. It closes the channel on completion/error. It adds no npm
packages, endpoints, authentication changes, or browser access to the engine.
The backend must serialize competing moves for a match and enforce which player
may move; a stateless rules service cannot arbitrate concurrent database writes.

With the engine running, try the standalone Node client:

```sh
node examples/client.mjs
```

To test the actual compiled NestJS service against the daemon:

```sh
(cd ../nestJS/42chess && npm ci && npm run build)
node tests/nest_client_test.mjs build/chess_engine
```

The transport is intentionally internal and unauthenticated. Do not publish its
port directly to the internet; keep client authorization and TLS at the backend
boundary. There is no database, filesystem game storage, outbound networking,
search/minimax, clocks for time controls, or chess variant support in this daemon.

## Tests and issue coverage

Tests use checks that remain active in Release builds, with no testing framework
required. The transport suite uses Python's standard library only.

| Issues | Implementation / tests |
| --- | --- |
| CHESS-01, 02, 03, 04, 05 | `ChessColor`, `PieceType`, checked `Square`, `Piece`, `BoardState`; types/FEN suite |
| CHESS-06, 07, 08 | Standard initialization, FEN import/export; exact round trips and rejected input |
| CHESS-09, 10, 11, 12, 13, 14 | Pawn, knight, bishop, rook, queen and king; movement/capture suites |
| CHESS-16, 17, 18 | Four promotions, both castles, en passant for both colors |
| CHESS-19, 20, 21, 22 | Attacks, king safety/pins, checkmate and stalemate |
| CHESS-23, 24, 25 | Material, history-aware repetition and halfmove clock |
| CHESS-26, 27 | Move validation and complete legal move generation |
| CHESS-28, 29, 30, 31, 32 | Movement, capture, promotion, castling and en passant test suites |
| CHESS-33, 34, 36, 37 | Check, mate, repetition and 50-move test suites |

Reference perft counts cover the initial position (20 / 400 / 8902 / 197281),
Kiwipete (48 / 2039 / 97862), a rook/en-passant endgame (2812 at depth 3) and a
promotion-heavy position (9467 at depth 3). Tests also cover pinned attacks,
double check, expired en passant, en passant exposing the king, castling through
check, lost castling rights, promotion captures, failed-move atomicity and draw
identity normalization. JSON tests cover schema failures and request isolation;
real socket tests cover handshake, fragmentation, ping/pong, simultaneous clients,
message limits and shutdown.

For sanitizer builds:

```sh
cmake -S . -B build-sanitize -DCHESS_SANITIZERS=ON -DCMAKE_BUILD_TYPE=Debug
cmake --build build-sanitize -j2
ctest --test-dir build-sanitize --output-on-failure
python3 tests/websocket_test.py build-sanitize/chess_engine
```
