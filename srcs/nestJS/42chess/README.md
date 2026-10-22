<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

This project is already instrumented. Create a free account at [observe.nestjs.com](https://observe.nestjs.com), add an application, and paste the generated app key and secret into the `ObserveModule.forRoot()` call in `src/app.module.ts`.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
# Lot 4 realtime transport

SCRUM-176, 177, 180, 181, 323 and 460: native JSON WebSocket at `/ws` on the
existing API server. Nginx forwards upgrade headers and preserves the public
host; Angular's development proxy supports the same path. Messages use
`{ "event": "EVENT_NAME", "data": {} }` (not Socket.IO framing).

The first message must be `AUTHENTICATE { accessToken }` within five seconds.
`RealtimeAuthenticator` is the SCRUM-178 integration point: it must verify the
signature, expiry and user eligibility and return `{ userId, expiresAt }`, with
expiry in epoch milliseconds. The default implementation returns
`AUTH_UNAVAILABLE` and closes with 4401; it deliberately authenticates nobody.
There is no production test bypass, URL token or client-supplied actor identity.
Authentication success returns `AUTHENTICATED { userId }`; the gateway also closes
at verified expiry. Nicolas's provider is required for production game events.

Transport bounds: 16 KiB incoming text JSON, no compression or binary frames,
60 frames per ten seconds, 32 queued frames and 256 KiB outgoing backpressure.
Ping/pong detects broken connections. Browser origins must match the public host
or the existing `CORS_ORIGINS` list. Disconnect/shutdown clears timers and calls
the message handler's cleanup hook. Errors use the existing public API shape;
credentials and frame contents are never logged.

Angular `RealtimeService` exposes connection state and events. Call `connect()`
when realtime is needed, `joinGame(id)`/`leaveGame(id)` for room subscriptions,
and `send(event, data)` for commands. Sending before acknowledgement returns
false. Network loss triggers up to five bounded exponential retries; successful
reauthentication rejoins rooms for a fresh state. Mutations are never replayed.
Session changes close the socket and clear memberships. Auth refusal stops
retries. Tests use actual sockets and a test-only verifier; those passing tests
do not establish production JWT integration.

# Lot 5 game event contract

SCRUM-182..193. After authentication:

| Client event | Data | Server response |
| --- | --- | --- |
| `JOIN_GAME` | `{ gameId }` | `GAME_STATE` full snapshot to room |
| `LEAVE_GAME` | `{ gameId }` | `GAME_LEFT { gameId }` to requester |
| `MAKE_MOVE` | `{ gameId, from, to, promotion? }` | `MOVE_PLAYED` per new ply, then `GAME_STATE` |
| `RESIGN` | `{ gameId }` | `GAME_STATE`, `GAME_ENDED` |
| `OFFER_DRAW` | `{ gameId }` | `DRAW_OFFERED`, `GAME_STATE` |
| `ACCEPT_DRAW` | `{ gameId }` | `GAME_STATE`, `GAME_ENDED` |
| `DECLINE_DRAW` | `{ gameId }` | `DRAW_DECLINED`, `GAME_STATE` |

`gameId` is a UUID, squares use lowercase algebraic coordinates, and promotion
is null/omitted or `QUEEN`, `ROOK`, `BISHOP`, `KNIGHT`. Extra fields, including
actor IDs, FEN or client clocks, are rejected. All legality, turn, agreement and
terminal-state checks use the existing transactional `GamesService` and C++
engine. Domain errors preserve REST codes (`NOT_YOUR_TURN`, `INVALID_MOVE`, etc.)
and `ERROR { statusCode, code, message }` goes only to the requesting socket.

Joining takes the second seat in a waiting open/invited game through the domain
service. Seated players can rejoin active or finished games idempotently; other
users cannot spectate through this transport. Eight subscriptions per connection
are allowed. Leaving/disconnecting only removes the subscription, never resigns
or pauses the game. Multiple tabs are independent subscriptions.

`GAME_STATE.data` is the existing REST `GameResponse`, plus `gameId` (equal to
`id`) and the full `moves` list from `GamePresenterService`. Reconnect obtains
this durable snapshot, including board, history, clocks, draw offer and result.
`MOVE_PLAYED.data` has `{ gameId, move, board, clocks, turn }` with the existing
`MoveResponse`; an action that instead settles a timeout emits no fictitious move.
Each ply not yet announced to a room gets its own `MOVE_PLAYED`, in order, with
the board after that ply: plies committed together (a bot reply) or through REST
(at the next refresh) are not skipped. `clocks` is the current server clock,
since per-ply clocks are not stored. Joining sends the snapshot, not past moves.
`DRAW_OFFERED`/`DRAW_DECLINED` have `{ gameId, playerId }`.

For subscribed active games, `CLOCK_UPDATE` is emitted once per second with
`{ gameId, clocks: { white, black }, turn, serverTime }`; balances are milliseconds
and serverTime is ISO UTC. The durable clock is settled before publication.
Clock/REST changes trigger a fresh snapshot; terminal results emit
`GAME_ENDED { gameId, result: { winner, reason } }` once per live room and stop
clock refreshes. A reconnecting finished-game client reads the snapshot result.
Commands and broadcasts are ordered per game with a bounded queue. PostgreSQL
locks remain authoritative across REST and WS. Room fanout currently targets one
NestJS process, matching the existing deployment; a multi-instance deployment
would require shared fanout before use.

Angular `GameRealtime` exposes a snapshot, clock updates, errors and typed
move/resign/draw methods without any board rendering or image assets. It ignores
unrelated game snapshots, clears state on logout, expiry or account change, and
relies on the transport for reconnection. A renewed token for the same user keeps
the watched game and sends `JOIN_GAME` again on the new connection. It never
applies optimistic chess moves.
