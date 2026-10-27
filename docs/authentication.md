# Authentication and local implementation lots

The application keeps the existing local registration, email verification and TOTP
flows. All completed sign-ins now issue a distinct revocable access session.
No application access token is stored in localStorage, sessionStorage or a URL.
Reloading a tab still requires a fresh sign-in; no refresh-token flow was added.

## Local branches

These branches form a stack, starting from `origin/main` at `f055b79`. Each branch
contains the preceding lot. Existing branches and commits are preserved. Lots
10–16 are published. [Integration PR #60](https://github.com/ErwanLucienMMV/ft_transcendance/pull/60)
targets dev_test and delivers all seven lots together, including fixture fixes
and profile integration.

| Branch | Tickets and scope |
| --- | --- |
| `feat/lot-10-auth-sessions` | SCRUM-77, 78, 79, 80, 91, 92: JWT sessions, logout, guard, current user |
| `feat/lot-11-authenticated-realtime` | SCRUM-178, 179, 533: real REST/WS identity and revocation |
| `feat/lot-12-session-client` | SCRUM-330: current-user refresh and server logout |
| `feat/lot-13-oauth-providers` | SCRUM-81..88, 93, 94: Google/GitHub protocol, callbacks, identity ownership |
| `feat/lot-14-oauth-client` | SCRUM-331, 332: provider buttons, callback screen, account linking controls |
| `feat/lot-15-auth-regression-validation` | SCRUM-89, 90, 444 and cross-lot regressions; existing registration/login/2FA coverage retained |
| `feat/lot-16-auth-profile-integration` | SCRUM-80, 534, 535: shared profile/session guard, preserved SCRUM-95 history, private local OAuth setup |

The final branch contains the complete local implementation. The original 24
remaining tickets are covered by these lots; real provider setup is tracked
separately in SCRUM-534. The user confirmed successful real Google and GitHub
sign-ins on localhost on 2026-10-26. This is not production deployment validation.

## Session contract

- Existing `POST /v1/auth/login` and `POST /v1/auth/2fa/verify` response shapes are
  unchanged. JWT claims additionally contain `jti` and `typ: access`.
- `GET /v1/users/me` requires a verified, unexpired, non-revoked bearer session.
  It preserves SCRUM-95's public profile projection (without email). Secrets
  and persistence/session internals are never serialized.
- `POST /v1/auth/logout` requires the bearer and returns 204. It revokes only that
  session; a replay returns 401, while another valid session remains usable.
- Game mutation routes use the same bearer verification. Existing trusted server
  principals and the game's `AUTH_REQUIRED` error contract are preserved.
- `/ws` accepts the existing `AUTHENTICATE` message with the access token. Identity
  comes from signature verification, a live session row and the current user.
  Every command revalidates the session. An idle socket revalidates once a second,
  so logout is enforced on open sockets within approximately one second, plus
  database latency. Database failures fail closed.
- Legacy JWTs without a persisted session are refused: sign in again after
  upgrading. Sessions survive an API restart but the browser still keeps its
  token only in memory.

Migrations `1792800000000-CreateAuthSessions` and
`1792800000001-CreateOauthFlows` are additive. Normal startup runs pending
migrations using the existing database module. Never reset the database to apply
these changes. Existing users, games, providers and backups are preserved.

## Optional Google and GitHub

`GET /v1/auth/oauth/providers` lists only configured providers. Leaving credentials
empty keeps the local application operational and hides the corresponding
buttons. The browser learns capabilities from the server at runtime; credentials
are never bundled into Angular.

Use the existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`
and `GITHUB_CLIENT_SECRET` environment variables. The canonical public origin is
`OAUTH_PUBLIC_URL`, falling back to `APPURL`. Production requires HTTPS; HTTP is
allowed only for `localhost` and `127.0.0.1`. Compose forwards these settings in
both production and development. No credential value belongs in Git.

Register these exact URLs with the provider applications, replacing the origin:

```text
https://your-host:your-port/api/v1/auth/oauth/google/callback
https://your-host:your-port/api/v1/auth/oauth/github/callback
```

The existing optional `GOOGLE_CALLBACK_URL` and `GITHUB_CALLBACK_URL` must match
these derived URLs when set. In development, use the Angular proxy origin, for
example `OAUTH_PUBLIC_URL=http://localhost:4200`, rather than the internal API
container name. Do not send the browser directly to a private container URL.

Routes behind Nginx use `/api/v1`; NestJS itself uses `/v1`:

| API route | Behavior |
| --- | --- |
| `GET /auth/oauth/:provider` | Begin login with state, browser-binding cookie and S256 PKCE |
| `GET /auth/oauth/:provider/callback` | Consume state, exchange the vendor code and redirect to `/oauth/callback` |
| `POST /auth/oauth/exchange` | Consume the HttpOnly, browser-bound handoff; requires `x-oauth-exchange: 1`; returns the usual token or 2FA challenge JSON |
| `GET /auth/oauth/accounts` | List providers linked to the bearer-authenticated account |
| `POST /auth/oauth/:provider/link` | Begin explicit linking, bound to the current live session; returns `authorizationUrl` |
| `DELETE /auth/oauth/:provider` | Remove that user's provider; reject removing the last available login method |

Provider code exchange and profile lookup happen only on the server, against
fixed Google/GitHub HTTPS endpoints. Vendor tokens are not persisted. State is
single-use and expires after five minutes; the final handoff expires after one
minute. Both are tied to an HttpOnly SameSite cookie. One browser flow at a time
is supported; starting another flow invalidates the previous browser binding.
Expired flow rows are cleaned up when a new flow starts.

An existing identity always maps to its internal user. A new identity creates a
local user with a generated available username. Only provider-verified emails
are used. A matching email never silently merges accounts: sign in to the local
account and explicitly link the provider. Identity creation is transactional;
the database uniqueness constraint and per-identity transaction lock prevent
concurrent callbacks from attaching the same identity to different users.
Linking also checks the initiating session is still valid at callback time.
Users with TOTP enabled must complete the existing second-factor step after
OAuth. Removing a provider never removes the user or their games.

Unlinking must leave a local password or another linked provider that is currently
configured. A disabled linked provider does not count as a usable login method.
Otherwise the API returns `409 OAUTH_LAST_LOGIN_METHOD` and keeps the link.
The user row is locked while checking and deleting, so concurrent unlink requests
cannot remove both remaining methods.

Protocol references:
[Google server-side authorization](https://developers.google.com/identity/protocols/oauth2/web-server)
and [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

## Validation

Use Node 22 or the existing Docker test runners. No dependency or lockfile update
is needed. The host does not need Node when using Docker.

```sh
# Backend: contracts, units, isolated PostgreSQL, HTTP/WS and bot adapter
make test

# Frontend: from srcs/angular/42chess with the locked dependencies
npm test -- --watch=false
npm run build

# Browser tests with a separate ephemeral PostgreSQL and captured mail
docker compose -f srcs/angular/compose.e2e.yml run --rm --build browser-tests
```

Backend OAuth tests replace only the outbound provider HTTP client; database,
routes, state consumption, session verification and TOTP challenge issuance are
real. Browser OAuth tests exercise hidden/enabled controls, redirect initiation,
callback errors and the second-factor handoff with test-scoped responses. No
production test mode, fixture token switch or relaxed authentication exists.
The user confirmed real Google and GitHub sign-ins on localhost on 2026-10-26
(SCRUM-534). Final-domain HTTPS callbacks and deployment credentials remain a
project closeout check, deliberately deferred until deployment.

Latest integration checks passed: 304 backend unit tests, 211 database tests,
109 HTTP/WS tests, backend contracts and real bot adapter, 109 frontend unit tests,
12 Chromium browser tests, and backend/frontend production builds.

## Profile integration and review order

Lot 16 merges Erwan's SCRUM-95 commit `9582d0f` without rewriting it. Only
`UsersController` serves `/v1/users/me`. `AccessTokenGuard` delegates to the shared
session guard, preserving `AUTH_REQUIRED` errors and the exact profile projection.
Deleted users and revoked sessions are refused; an independent session remains
usable. Existing invalid-token and second-factor rejection tests are retained.

For incremental review, compare lot 10 against `main`, then each subsequent lot
against the preceding lot (11 against 10, through 16 against 15). Lot 16 also
includes the preserved SCRUM-95 implementation. PR #60 delivers the complete
validated combination: fixture fixes in lot 15 are required by the earlier
migrations, so intermediate lots are not independently merge-ready. Recheck the
actual target branch and PR CI before merging. No history rewrite or target-branch
merge has been performed.

## Private localhost provider setup

After registering provider applications, run from the repository root:

```sh
bash srcs/configure-oauth-local.sh github
bash srcs/configure-oauth-local.sh google
```

Enter the client ID and secret interactively. Secret input is hidden; values are
never printed. The helper creates/appends only the requested provider in the
Git-ignored `srcs/.env.oauth.local` with owner-only permissions and refuses to
overwrite existing credentials. Never paste secrets into chat or commit them.
The helper requires Bash and ripgrep (`rg`).

Use these exact registered callback URLs:

```text
http://localhost:4200/api/v1/auth/oauth/google/callback
http://localhost:4200/api/v1/auth/oauth/github/callback
```

With the normal development environment initialized using `sh srcs/init-env.sh`,
start the local services (or update the API after configuring another provider):

```sh
docker compose --env-file srcs/.env --env-file srcs/.env.oauth.local \
  -p ftchess-oauth-local -f srcs/docker-compose.dev.yml \
  up -d --build angular nestjs postgres forgemail bot chess-engine
# After adding credentials to an already running environment:
docker compose --env-file srcs/.env --env-file srcs/.env.oauth.local \
  -p ftchess-oauth-local -f srcs/docker-compose.dev.yml up -d nestjs
```

Open `http://localhost:4200/login`. Use localhost consistently for cookies and
callbacks. Provider credentials are private to this machine, not supplied by a
Git checkout. Configure the server separately for its final HTTPS origin and
register matching provider callbacks before the final evaluation.

## Final verification and parallel integration

See [the final review report](review-readiness-2026-10-26.md) for the checked
These.md contracts, production image/startup checks, collaborator conflicts and
next tickets. Compare lots incrementally for review. They are delivered together
in PR #60 targeting dev_test, including all fixture and profile fixes, so the
workflows restricted to main/dev_test PR bases execute. Do not assume a PR
between feature branches triggers the full backend CI.

Puzzle PR #58 is now integrated from `dev_test` into PR #60. The shared
`AccessTokenGuard` delegates to session verification and preserves `AUTH_REQUIRED`;
`PuzzlesModule` imports the session module. Puzzle HTTP tests issue persisted
sessions and verify logout revocation without changing progress or other sessions.
See [the review corrections](review-fixes-2026-10-26.md) for conflict resolution,
the OAuth regression and the combined validation results.

The parallel presence branches still require coordinated integration:
PresenceGateway must share the existing /ws transport rather than register a
second upgrade owner, and use live sessions rather than its stateless guard.
Those branches have not been modified by this correction.
