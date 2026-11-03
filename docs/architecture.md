# Application architecture

SCRUM-508 · Source baseline: `dev_test`, updated 2 November 2026.

## Runtime boundaries

| Boundary | Responsibility | Source |
| --- | --- | --- |
| Angular | Browser navigation, account/social screens, chessboard, realtime rendering, English/French/Spanish | `srcs/angular/42chess/src/app` |
| Nginx | Production TLS, prerendered pages and Angular files, security headers, rate limits, HTTP API and WebSocket reverse proxy | `srcs/angular/conf/nginx.conf` |
| NestJS | Authentication, authorization, domain transactions, public responses | `srcs/nestJS/42chess/src` |
| PostgreSQL | Durable users, sessions, games, moves, social/chat, blocks, ratings, progression and puzzles | `srcs/nestJS/42chess/src/database` |
| forgemail | SMTP delivery (or local log) of verification, password-reset and alert emails | `srcs/forgemail` |
| chess-engine | C++ rules, legality and board transitions over WebSocket | `srcs/chess-engine` |
| bot | C++ computer-opponent search over WebSocket | `srcs/bot` |
| Prometheus/Alertmanager/Grafana | Metric collection from the API and three exporters (machine, containers, PostgreSQL), tested alert rules sent by email, provisioned dashboards | `srcs/prometheus`, `srcs/alertmanager`, `srcs/grafana` |
| Backup service | Independent hourly dumps to a host folder and all-or-nothing restoration | `backup`, `BACKUP.md` |

The production services share the `transcendence` Compose network. The backup
Compose project joins it as an external network and has independent storage.
Nginx serves the browser entry point: `/api/` forwards to NestJS with the
`/api` prefix removed, `/ws` preserves WebSocket upgrade headers, and `/grafana/`
forwards to Grafana. Development uses an Angular proxy in place of Nginx.
Only Nginx publishes ports; the database, Prometheus, Alertmanager and the
exporters are reachable from the network alone, and the API's metrics answer
404 through Nginx. The front is a static build: the pages that do not depend on
the account (home, sign-in, rules, legal pages) are prerendered, the rest is
rendered in the browser.

## API composition and trust

[AppModule](../srcs/nestJS/42chess/src/app.module.ts) composes Auth, OAuth,
Users, Friends, Social (blocks), Games, Matchmaking, Chat, Rating, Progression,
Puzzles, Bots, Presence, Realtime, Health, Metrics and Database modules. Controllers validate public inputs and
delegate to services. A global validation pipe rejects extra properties, and
the API exception filter provides structured public errors without internal
exception details.

Accounts use salted Argon2id passwords, email verification, optional TOTP
two-factor authentication with recovery codes, JWT access tokens and
database-backed refresh sessions. Refresh secrets travel in httpOnly cookies;
authentication binds domain actions to the verified principal, and revoking a
session closes its sockets. Google/GitHub/42 OAuth exchanges stay server-side,
with browser-bound state and PKCE. The client cannot select its acting user by
sending a body field. Sign-in and email routes are rate-limited by Nginx and by
the API ([HTTP rate limits](http-rate-limiting.md)); the API runs as a non-root
user.

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
agreement flows. Persisted moves support replay and recovery. The server
applies the end rules: automatic fivefold repetition and seventy-five-move
draws, claims, aborts before the first moves, victory claims after an
opponent's minute-long absence, and Elo only for rated games.

The realtime layer publishes game state, moves, clocks and terminal events.
Spectators may observe but cannot perform player actions. Joining/leaving a
room does not itself resign a game. Server clocks and terminal state remain
authoritative; client display clocks cannot change the stored result.

Private messages are persisted before delivery and expose actor-scoped paginated
history, with read receipts and typing hints; blocking stops messages,
challenges and requests both ways. Game chat checks participation or spectator access separately. Friend
requests and accepted friendships have distinct lifecycle rules. Puzzle play
stores per-user attempts and verifies proposed moves without returning future
solution moves. Elo changes come from terminal game settlement, never profile input.

## Persistence, startup and operation

TypeORM migrations define schema evolution; database entities and
[the data model](../srcs/nestJS/42chess/DATABASE-MODEL.md) document persistence.
PostgreSQL, Prometheus, Alertmanager, Grafana and uploaded pictures each have
persistent volumes. Backups go to a host folder (`backups/`), separate from
every volume, with hourly dumps retained for 24 hours; a restore stops the
application and is all or nothing. It is local recovery storage, not an
off-host redundancy guarantee.
See [backup and recovery](../BACKUP.md) for restoration and data-loss boundaries.

`make full` starts the main stack, imports bundled puzzles through the rules
engine and then starts backups. PostgreSQL and forgemail health gate NestJS;
NestJS health gates Nginx. The health check (`/v1/health`) also reports the
rules engine, bot, mail and the last backup; it feeds the public `/status` page
and the alerts. Configuration is injected per service by Compose, with
host-side validation and startup diagnostics.

Current realtime room fanout lives in one NestJS process. The shipped deployment
uses one API instance; horizontal replication would need shared fanout before
it could preserve cross-instance notifications.

## Verification boundaries

Unit tests cover validation and isolated services; database integration tests
exercise migrations and transactional invariants. CI checks lint and
formatting, the Nginx limits, the images and the monitoring configuration, then
runs the backend, bot, mail, frontend and browser suites. HTTP/actual-socket E2E tests
use a dedicated PostgreSQL database plus real rules/bot fixtures. Angular has
component and Playwright browser suites. Test fixtures are distinct from live
application storage. A unit test with a substituted external boundary does not
prove live SMTP/OAuth-provider behavior.

Further detail: [authentication](authentication.md), [accounts](accounts.md),
[social](social.md), [progression](progression.md), [languages](i18n.md),
[monitoring](../DOC_MONITORING.md), [game clock sync](game-clock-sync.md),
[private messaging](private-messaging.md), [matchmaking](matchmaking-workflow.md),
[puzzles](puzzles/README.md), [database diagram](database-diagram.md).
