*This project has been created as part of the 42 curriculum by emaigne, galmarti, hcombaud.*

# 42 Chess

## Description

42 Chess is an online chess site built for **ft_transcendence**, the last project of the 42
common core. Its goal is a complete, secure web application where people play chess in real
time against each other or against the computer, follow each other's games and talk, with the
infrastructure a real service needs: HTTPS everywhere, monitoring, alerts, backups and
documentation.

Key features:

- **Play online**: rated games against a player of similar Elo (matchmaking), casual or rated
  games against a friend through a link or a challenge, games against a computer opponent with
  three levels. The server checks every move with a C++ rules engine and applies the FIDE rules:
  checkmate, stalemate, insufficient material, repetition, 50 and 75 moves, time, resignation,
  draw offers, abandonment and aborted games.
- **Watch and review**: every game in progress can be watched live, finished games are replayed
  move by move, exported as PGN or opened on an analysis board.
- **Social**: profiles, friends, presence (online, in a game), private messages with read
  receipts and typing indicator, game chat, challenges, blocking.
- **Progression**: Elo rating and its history, leaderboard, statistics, experience points,
  levels, achievements, a daily puzzle with hints and an archive.
- **Accounts**: email verification, two-factor authentication with recovery codes, sign-in with
  Google, GitHub or 42, password reset, avatar upload, data export and account deletion.
- **For everyone**: English, French and Spanish, light and dark themes, keyboard and screen
  reader support, responsive layout.
- **Operations**: Prometheus and Grafana dashboards, email alerts, a public status page, hourly
  database backups and a tested restore procedure.

## Instructions

### Prerequisites

- Linux or macOS with **Docker Engine 24+** and **Docker Compose v2** (`docker compose`).
- **GNU make** and a POSIX shell.
- Free ports **80** and **8080** (both can be changed in `srcs/.env`), and about 6 GB of disk
  for the images.
- Optional, to run the tests outside Docker: **Node.js 22** and npm.

### Configuration

All settings live in `srcs/.env`, created from [`srcs/.env.example`](srcs/.env.example):

```bash
make env
```

`make env` copies the example and generates every secret that is empty (database and backup
passwords, `JWT_SECRET`, Grafana administrator, alert webhook token). It never changes a value
already set, then warns about settings that would break sign-in, emails or links. Edit the file
afterwards for:

| Setting | Why |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Sending verification and password emails. Empty credentials only log the emails (`docker logs forgemail`). |
| `APPURL`, `APPPORT`, `HTTPPORT` | The public address of the site (default `https://localhost:8080`). |
| `GOOGLE_*`, `GITHUB_*`, `FORTYTWO_*` | Optional sign-in providers; a provider without credentials is hidden. |
| `ALERT_EMAIL` | Addresses that receive monitoring alerts. |

### Run

```bash
make            # builds the images, starts the stack, imports the puzzles
```

Then open **https://localhost:8080**. The certificate is self-signed: accept the browser
warning, or replace `/etc/nginx/ssl/transcendence.crt` and `.key` with a real certificate.
Grafana is at **https://localhost:8080/grafana/**, with the `GF_SECURITY_ADMIN_*` account of
`srcs/.env`.

| Command | Effect |
| --- | --- |
| `make full` | `make`, plus the backup service (a backup every hour). |
| `make loud` | Starts in the foreground with all logs. |
| `make dev` | Development stack with hot reload. |
| `make down` / `make clean` | Stops / removes the containers; data is kept. |
| `make fclean` | Also deletes the database and monitoring volumes (asks first). |
| `make re` | Rebuilds and restarts everything. |
| `make backup-now`, `make backups`, `make restore BACKUP=<file>` | Backups, see [BACKUP.md](BACKUP.md). |
| `make test` | API unit, database and end-to-end tests, mail service and bot tests, in Docker. |
| `make check-monitoring` | Checks Prometheus, the alert rules and Grafana dashboards. |

Front-end tests run from `srcs/angular/42chess` (`npm ci`, then `npm test`); the browser tests
run against the whole stack with
`docker compose -f srcs/angular/compose.e2e.yml run --rm --build browser-tests`.

### Documentation

[`docs/`](docs) holds one page per subject. The main entry points:

- **Setting up**: [local installation](docs/local-installation.md),
  [environment variables](docs/environment.md), [Docker operation](docs/docker.md) and
  [OAuth providers](docs/oauth.md).
- **How it is built**: [architecture](docs/architecture.md) and its
  [deployment diagram](docs/architecture-diagram.md), the [REST and realtime API](docs/api.md)
  with [request examples](docs/api-examples.md), the
  [database model](srcs/nestJS/42chess/DATABASE-MODEL.md) and its
  [diagram](docs/database-diagram.md).
- **Features**: [authentication](docs/authentication.md), [accounts](docs/accounts.md),
  [live game](docs/live-game.md), [matchmaking](docs/matchmaking-policy.md), [bot](docs/bot.md),
  [social](docs/social.md), [progression](docs/progression.md),
  [puzzles](docs/puzzles/README.md), [design system](docs/design-system.md),
  [languages](docs/i18n.md) and [legal pages](docs/legal-pages.md).
- **Operations and security**: [monitoring](DOC_MONITORING.md), [backups](BACKUP.md),
  [disaster recovery](docs/reprise-apres-sinistre.md) and
  [HTTP rate limits](docs/http-rate-limiting.md).

## Resources

References used throughout the project:

- [FIDE Laws of Chess](https://handbook.fide.com/chapter/E012023), the
  [Elo rating system](https://en.wikipedia.org/wiki/Elo_rating_system) and the
  [PGN standard](https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm).
- [Chess Programming Wiki](https://www.chessprogramming.org/) (move generation, alpha-beta,
  evaluation) for the rules engine and the computer opponent.
- [Lichess open puzzle database](https://database.lichess.org/#puzzles) (CC0), the source of
  the puzzles.
- Framework documentation: [Angular](https://angular.dev), [NestJS](https://docs.nestjs.com),
  [TypeORM](https://typeorm.io), [PostgreSQL](https://www.postgresql.org/docs/15/),
  [Transloco](https://jsverse.gitbook.io/transloco), [Boost.Beast](https://www.boost.org/libs/beast).
- Protocols: [RFC 6455 (WebSocket)](https://www.rfc-editor.org/rfc/rfc6455),
  [RFC 6749 (OAuth 2.0)](https://www.rfc-editor.org/rfc/rfc6749) with
  [PKCE (RFC 7636)](https://www.rfc-editor.org/rfc/rfc7636),
  [RFC 6238 (TOTP)](https://www.rfc-editor.org/rfc/rfc6238),
  [OWASP Cheat Sheets](https://cheatsheetseries.owasp.org/) (sessions, passwords, headers).
- Operations: [Prometheus](https://prometheus.io/docs/), [Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/),
  [Grafana](https://grafana.com/docs/grafana/latest/), [nginx](https://nginx.org/en/docs/).
- Privacy and accessibility: [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj),
  [CNIL](https://www.cnil.fr), [WCAG 2.1](https://www.w3.org/TR/WCAG21/).

### Use of AI

An AI coding assistant was used in the last phase of the project:

- to **audit** the whole repository against the subject (bugs, unfinished modules, security,
  accessibility, missing documentation) and turn the findings into a list of tasks;
- to **implement** a large part of that list, delivered as ten branches and pull requests:
  infrastructure and security hardening, complete game end rules, the computer opponent's
  levels, account management, social controls, progression, monitoring and alerts, front-end
  design system and comfort, translations, and this documentation;
- to **write tests** for these changes (unit, database, API end-to-end and browser tests) and
  to **translate** the interface into French and Spanish.

Each change is delivered as a pull request, runs the full test suites and is reviewed by the
team before it is merged.
<!-- TODO(team): add any other use of AI by each member, or confirm there was none. -->

## Team Information

The team chose not to split the PO, PM and Tech Lead roles between people: everyone is a
**developer** who worked on several parts of the project, and the product, planning and
technical decisions are taken together at the weekly meeting (see
[Project Management](#project-management)). Each member still owns the areas below.

| Member | Role(s) | Responsibilities |
| --- | --- | --- |
| **emaigne** (Erwan Maigne-Montamat) | Developer; shared product, planning and technical decisions | Social back end (friends, presence, private messages), matchmaking and Elo rating, daily puzzle, metrics and Grafana dashboards, backups, CI. |
| **galmarti** | Developer; shared product, planning and technical decisions | C++ chess rules engine and computer opponent, their integration in the API (games, bots), puzzle validation. |
| **hcombaud** (Tatoub) | Developer; shared product, planning and technical decisions | Angular front end, real-time games and spectating, OAuth and sessions, account management, progression, alerts and status page, security hardening, translations, documentation. |

Former member: **ntassin** (Nicolas Tassin) built the first authentication (registration,
email verification, sign-in, two-factor authentication), the users module and the email
service before leaving the team.

## Project Management

- **Weekly meeting**: every Monday, in person. The team reviews the tickets finished during
  the week, then each member takes about thirty new Jira tickets for the coming week.
- **Planning**: work is tracked in **Jira** (project `SCRUM`), split into epics per area
  (games, matchmaking, social, puzzles, observability, front end, tests) and organised in
  weekly sprints. Ticket numbers are quoted in the feature documents of [`docs/`](docs).
- **Code flow**: one branch per feature, merged into `dev_test` through **GitHub pull
  requests**, then into `main`. GitHub Actions run lint, formatting, every test suite, the
  Docker build and the monitoring checks on each pull request.
- **Communication**: a team **Discord** server for daily questions, reviews and blockers
  between meetings.

## Technical Stack

| Part | Technologies |
| --- | --- |
| Front end | Angular 22 (standalone components, signals), TypeScript, Transloco, hand-written CSS with design tokens, Vitest and Playwright |
| Back end | NestJS 12 on Node.js 22, TypeORM 0.3, WebSocket (`ws`), Argon2id, JWT, otplib, class-validator, Vitest |
| Database | PostgreSQL 15 |
| Rules engine and bot | C++17, Boost.Asio and Boost.Beast (WebSocket), nlohmann/json |
| Email | forgemail, a small Node.js service using Nodemailer |
| Infrastructure | Docker Compose, nginx (TLS, reverse proxy, rate limits, security headers), Prometheus, Alertmanager, Grafana, node-exporter, cAdvisor, postgres-exporter, cron backups with `pg_dump` |

Why these choices:

- **Angular and NestJS** share TypeScript and the same structure (modules, dependency
  injection, decorators), so every member can work on both sides. Angular's signals keep a
  real-time page (clocks, moves, presence) simple, and its prerendering serves the public
  pages (home, sign-in, legal pages) as static HTML.
- **No CSS framework**: the look is a small design system written by hand with CSS custom
  properties (colours, type, radii), which gives two complete themes from one set of
  components and keeps the bundle small. See [docs/design-system.md](docs/design-system.md).
- **PostgreSQL** because the data is relational and must stay consistent: a game end updates
  the game, both ratings, the rating history, experience and achievements in one transaction,
  and constraints (`CHECK`, unique keys, foreign keys) protect the rules even against a bug.
  JSONB holds the few free-form fields (preferences). **TypeORM** gives typed entities and
  versioned migrations.
- **C++ services** for the chess rules and the bot: move generation and search are CPU-bound
  and benefit from a compiled language; as separate WebSocket services, they are shared by
  every game and can fail without taking the API down (the status page reports them).
- **WebSockets** for games, chat, presence and notifications: moves, clocks and messages must
  reach every player and spectator at once.
- **Prometheus, Alertmanager and Grafana**: the standard open-source monitoring stack, required
  by the monitoring module, with alerts sent by email.

## Database Schema

The full diagram is in [docs/database-diagram.md](docs/database-diagram.md) (Mermaid) and every
column, type and constraint in
[srcs/nestJS/42chess/DATABASE-MODEL.md](srcs/nestJS/42chess/DATABASE-MODEL.md). Primary keys are
UUIDs; all dates are `timestamptz`.

| Table | Key fields | Relations |
| --- | --- | --- |
| `users` | `username` (unique, case-insensitive), `email` (unique), `passwordHash` (Argon2id), `elo`, game counters, `preferences` (JSONB), two-factor and reset fields, `deletedAt` | parent of almost every table |
| `auth_sessions` | `expiresAt`, `revokedAt`, refresh token hashes | `userId` → `users` |
| `oauth_accounts`, `oauth_flows` | `provider`, provider account id; temporary PKCE state | `userId` → `users` |
| `games` | `status`, `result`, `endReason`, `rated`, `currentFen`, `initialTime` and `increment`, `clock` (JSONB), draw offers | `invitedOpponentId` → `users` |
| `game_players` | `color`, `botDifficulty` (computer seat) | `gameId` → `games`, `userId` → `users` |
| `moves` | `ply`, `notation` (SAN), `uci`, `fenAfter` | `gameId` → `games`, seat `(gameId, color)` |
| `rating_history` | `ratingBefore`, `ratingAfter` | `userId` → `users`, `gameId` → `games` |
| `matchmaking_queue` | `rating`, `initialTime`, `increment`, `status`, `leaseExpiresAt`, `matchedGameId` | `userId` → `users` (one entry per user) |
| `friend_requests`, `friendships`, `user_blocks` | `status`, `resolvedAt` | two `users` each |
| `messages`, `game_messages` | `content`, `readAt` | sender and recipient → `users`; `gameId` → `games` |
| `puzzles`, `daily_puzzles`, `puzzle_attempts` | `fen`, `solution`, `rating`, `themes`, Lichess `sourceId`; `date`; `mistakes`, `hintUsed`, `revealed`, `solved` | `puzzleId` → `puzzles`, `userId` → `users` |
| `user_progress`, `xp_events`, `achievements`, `user_achievements` | `xp`, streaks; one row per award; catalogue; unlock date | `userId` → `users`, `code` → `achievements` |

## Features List

| Feature | Description | Member(s) |
| --- | --- | --- |
| Registration and sign-in | Account with email verification, sign-in by username or email, sessions renewed by an httpOnly refresh cookie and revocable, rate-limited routes | ntassin, hcombaud |
| Two-factor authentication | TOTP with QR code, 10 single-use recovery codes, lock after repeated wrong codes | ntassin, hcombaud |
| Remote sign-in | Google, GitHub and 42 (OAuth 2.0 with PKCE), linking and unlinking from the settings | hcombaud |
| Account management | Profile, avatar upload, password change and reset, data export, account deletion | hcombaud |
| Email service | Verification, password and alert emails over SMTP | ntassin |
| Chess rules engine | Legal moves, check, mate, draws and repetition counting, as a C++ WebSocket service | galmarti |
| Online games | Real-time moves, server clocks, draw offers and claims, resignation, abandonment, aborts, rated and casual games, PGN | hcombaud, emaigne, galmarti |
| Matchmaking and Elo | Queue by time control with a widening Elo window, rating updates and history | emaigne |
| Computer opponent | Three levels with an opening book, varied choices and bounded mistakes | galmarti, hcombaud |
| Spectating and live games | Any game in progress can be watched; live list filtered by time control | hcombaud |
| History, replay and analysis | Finished games, move-by-move replay, analysis board | hcombaud |
| Friends and presence | Requests, friends list, online and in-game status | emaigne, hcombaud |
| Chat | Private messages with read receipts and typing, game chat for players and spectators, challenges from a conversation, blocking, friends-only contact | emaigne, hcombaud |
| Puzzles | Catalogue checked by the engine, daily puzzle, hints, solution, archive | emaigne, galmarti, hcombaud |
| Progression | Leaderboard, statistics, experience, levels, achievements, live notifications | hcombaud |
| Monitoring and alerts | Application and host metrics, Grafana dashboards, alert rules sent by email | emaigne, hcombaud |
| Status, backups and recovery | Health check, public status page, hourly backups, all-or-nothing restore | emaigne, hcombaud |
| Interface | Design system, light and dark themes, three languages, keyboard and screen reader support | hcombaud |
| Legal pages | Privacy Policy and Terms of Service, accepted at registration | hcombaud |

## Modules

| Module | Type | Points | Why and how | Member(s) |
| --- | --- | --- | --- | --- |
| Web: frameworks for front end and back end | Major | 2 | Angular 22 front end and NestJS 12 API, sharing TypeScript. | all |
| Web: real-time features (WebSockets) | Major | 2 | One authenticated WebSocket per tab for moves, clocks, chat, presence and notifications; reconnection resumes the game; broadcasts go only to a game's players and spectators. | hcombaud, emaigne |
| Web: user interaction | Major | 2 | Private chat, profiles, friends (add, remove, list), plus blocking and challenges. | emaigne, hcombaud |
| Web: ORM | Minor | 1 | TypeORM entities and versioned migrations on PostgreSQL. | all |
| Web: custom design system | Minor | 1 | Tokens for colours, type and icons, 15 reusable components, a living guide at `/design`. | hcombaud |
| Accessibility: multiple languages | Minor | 1 | English, French and Spanish with Transloco, switcher in the footer and settings, every text translated. | hcombaud |
| User management: standard user management | Major | 2 | Profile and avatar, friends and online status, profile pages with stats and history. | hcombaud, ntassin |
| User management: game statistics and match history | Minor | 1 | Results, rating curve, rank and full game history with replay. | hcombaud, emaigne |
| User management: remote authentication (OAuth 2.0) | Minor | 1 | Google, GitHub and 42 with PKCE. | hcombaud |
| User management: complete 2FA | Minor | 1 | TOTP, recovery codes, enable and disable from the settings. | ntassin, hcombaud |
| AI: AI opponent | Major | 2 | Native C++ bot with alpha-beta search and three levels that play like a human (opening book, varied and imperfect choices, think time). | galmarti, hcombaud |
| Gaming: complete web-based game | Major | 2 | Chess with every FIDE ending, clocks and a clear game page. | galmarti, hcombaud |
| Gaming: remote players | Major | 2 | Two players on separate computers, server-side validation, disconnection and abandonment handled. | hcombaud, emaigne |
| Gaming: advanced chat | Minor | 1 | Blocking, game invitations from the chat, read receipts, typing, links to profiles. | emaigne, hcombaud |
| Gaming: gamification | Minor | 1 | Experience, levels, 14 achievements, daily puzzle streak, leaderboard. | hcombaud |
| Gaming: spectator mode | Minor | 1 | Live list of games and real-time spectating with its own chat label. | hcombaud |
| DevOps: monitoring with Prometheus and Grafana | Major | 2 | Exporters for host, containers and PostgreSQL, application metrics, dashboards, tested alert rules, alerts by email. | emaigne, hcombaud |
| DevOps: health check, status page, backups and recovery | Minor | 1 | `/api/v1/health`, public `/status`, hourly backups, documented and tested restore. | emaigne, hcombaud |
| Data: GDPR compliance | Minor | 1 | Data export, account deletion with anonymised games, privacy policy describing the real data. | hcombaud |

**Total implemented: 27 points** (8 major modules = 16, 11 minor modules = 11). The subject
counts 14 points for the mandatory part and at most 5 bonus points.

Server-side rendering is not claimed: public pages are prerendered at build time and served as
static files.

## Individual Contributions

**emaigne** built most of the social and competitive back end: the friends system and friend
requests, presence, private messages, the game chat API, matchmaking with its Elo window and
the rating service. He also wrote the daily puzzle selection, the application metrics with the
first Grafana dashboards, the backup service and part of the CI. Challenges: making two
simultaneous matchmaking requests create a single game (atomic creation and leases in the
queue), and keeping game clocks in sync between the server and every client.

**galmarti** wrote the two C++ services: the rules engine (move generation, check and mate,
repetition and draw rules, served over WebSocket) and the native bot that reuses it with its own
search. He integrated both in the API (games and bot seats) and validated the puzzle catalogue
with the engine. Challenges: correct special moves and draw rules in a standalone engine, and a
bot fast enough to answer within the game clock.

**hcombaud** wrote the Angular application (board, game, live, history, social, chat, puzzle
and settings pages), the real-time game flow and spectating, OAuth sign-in and sessions, and
led the final audit and its ten lots: security hardening, complete end-of-game rules, bot
levels, account management (avatars, two-factor management, password reset, export,
deletion), social controls, progression, monitoring alerts and the status page, the design
system, the translations and this documentation. Challenges: keeping one consistent game state
across reconnections, refreshed sessions and many tabs, and translating every text of a large
interface without leaving any behind (checked by tests).

**ntassin** (former member) built the first authentication: registration, email verification,
password sign-in, two-factor authentication, the users module and the forgemail email service.

<!-- TODO(team): review these summaries and add the difficulties each member wants to highlight. -->

## Known limitations

- The certificate is self-signed for local use.
- Without SMTP credentials, emails are only written to the forgemail logs.
- The bundled puzzle catalogue holds 128 puzzles; more can be imported from the Lichess
  database (see [docs/puzzles/README.md](docs/puzzles/README.md)).
- Right-to-left languages are not supported.

## Credits

The puzzles come from the Lichess open database (CC0). Fonts: Inter and Space Grotesk
(SIL Open Font License, through Fontsource). This is a school project, not intended for
commercial use.
