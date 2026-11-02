# Application architecture

SCRUM-508 · Source baseline: `dev_test`, 2 November 2026.

## Runtime boundaries

| Boundary | Responsibility | Source |
| --- | --- | --- |
| Angular | Browser navigation, account/social screens, chessboard, realtime rendering | `srcs/angular/42chess/src/app` |
| Nginx | Production TLS, Angular files, HTTP API and WebSocket reverse proxy | `srcs/angular/conf/nginx.conf` |
| NestJS | Authentication, authorization, domain transactions, public responses | `srcs/nestJS/42chess/src` |
| PostgreSQL | Durable users, sessions, games, moves, social/chat, ratings and puzzles | `srcs/nestJS/42chess/src/database` |
| forgemail | SMTP delivery or local logged verification email | `srcs/forgemail` |
| chess-engine | C++ rules, legality and board transitions over WebSocket | `srcs/chess-engine` |
| bot | C++ computer-opponent search over WebSocket | `srcs/bot` |
| Prometheus/Grafana | Metric collection and provisioned dashboards | `srcs/prometheus`, `srcs/grafana` |
| Backup service | Independent hourly dumps and manual restoration | `backup`, `BACKUP.md` |

The production services share the `transcendence` Compose network. The backup
Compose project joins it as an external network and has independent storage.
Nginx serves the browser entry point: `/api/` forwards to NestJS with the
`/api` prefix removed, `/ws` preserves WebSocket upgrade headers, and `/grafana/`
forwards to Grafana. Development uses an Angular proxy in place of Nginx.
The current Compose file also publishes PostgreSQL and Prometheus host ports;
deployment firewall policy must account for these.

## API composition and trust

[AppModule](../srcs/nestJS/42chess/src/app.module.ts) composes Auth, OAuth,
Users, Friends, Games, Matchmaking, Chat, Rating, Puzzles, Bots, Presence,
Realtime, Metrics and Database modules. Controllers validate public inputs and
delegate to services. A global validation pipe rejects extra properties, and
the API exception filter provides structured public errors without internal
exception details.

Accounts use salted Argon2id passwords, email verification, JWT access tokens
and database-backed refresh sessions. Refresh secrets travel in httpOnly
cookies; authentication binds domain actions to the verified principal.
Google/GitHub OAuth exchanges stay server-side, with browser-bound state and
PKCE. The client cannot select its acting user by sending a body field.

WebSockets use native JSON `{ "event": "NAME", "data": {} }` envelopes, not
Socket.IO. The first event authenticates the connection with an access token.
Message handlers enforce role and room membership, and domain services enforce
the same rules as REST. Transport limits cover frame bytes, message frequency,
queued work and outbound backpressure. Reconnect retrieves authoritative state;
the browser does not replay chess mutations automatically.

## Game consistency

NestJS owns seats, invitations, turn authorization, clocks, results and rating
settlement. The rules engine validates moves and computes resulting positions;
the bot service chooses replies. PostgreSQL transactions and game-row locking
serialize competing actions across REST, WebSockets, timeout settlement and
agreement flows. Persisted moves support replay and recovery.

The realtime layer publishes game state, moves, clocks and terminal events.
Spectators may observe but cannot perform player actions. Joining/leaving a
room does not itself resign a game. Server clocks and terminal state remain
authoritative; client display clocks cannot change the stored result.

Private messages are persisted before delivery and expose actor-scoped paginated
history. Game chat checks participation or spectator access separately. Friend
requests and accepted friendships have distinct lifecycle rules. Puzzle play
stores per-user attempts and verifies proposed moves without returning future
solution moves. Elo changes come from terminal game settlement, never profile input.

## Persistence, startup and operation

TypeORM migrations define schema evolution; database entities and
[the data model](../srcs/nestJS/42chess/DATABASE-MODEL.md) document persistence.
PostgreSQL, Prometheus and Grafana each have persistent volumes. The backup
volume is separate from live database storage, with hourly dumps retained for
24 hours. It is local recovery storage, not an off-host redundancy guarantee.
See [backup and recovery](../BACKUP.md) for restoration and data-loss boundaries.

`make full` starts the main stack, imports bundled puzzles through the rules
engine and then starts backups. PostgreSQL and forgemail health gate NestJS;
NestJS health gates Nginx. Configuration is injected per service by Compose,
with host-side validation and startup diagnostics.

Current realtime room fanout lives in one NestJS process. The shipped deployment
uses one API instance; horizontal replication would need shared fanout before
it could preserve cross-instance notifications.

## Verification boundaries

Unit tests cover validation and isolated services; database integration tests
exercise migrations and transactional invariants. HTTP/actual-socket E2E tests
use a dedicated PostgreSQL database plus real rules/bot fixtures. Angular has
component and Playwright browser suites. Test fixtures are distinct from live
application storage. A unit test with a substituted external boundary does not
prove live SMTP/OAuth-provider behavior.

Further detail: [authentication](authentication.md), [game clock sync](game-clock-sync.md),
[private messaging](private-messaging.md), [matchmaking](matchmaking-workflow.md),
[puzzles](puzzles/README.md), [database diagram](database-diagram.md).
