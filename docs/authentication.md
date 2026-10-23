# Authentication and local implementation lots

The application keeps the existing local registration, email verification and TOTP
flows. All completed sign-ins now issue a distinct revocable access session.
No application access token is stored in localStorage, sessionStorage or a URL.
Reloading a tab still requires a fresh sign-in; no refresh-token flow was added.

## Local branches

These branches form a stack, starting from `origin/main` at `f055b79`. Each branch
contains the preceding lot. Existing branches and commits are preserved. No push
or pull request is part of this work.

| Branch | Tickets and scope |
| --- | --- |
| `feat/lot-10-auth-sessions` | SCRUM-77, 78, 79, 80, 91, 92: JWT sessions, logout, guard, current user |
| `feat/lot-11-authenticated-realtime` | SCRUM-178, 179, 533: real REST/WS identity and revocation |
| `feat/lot-12-session-client` | SCRUM-330: current-user refresh and server logout |
| `feat/lot-13-oauth-providers` | SCRUM-81..88, 93, 94: Google/GitHub protocol, callbacks, identity ownership |
| `feat/lot-14-oauth-client` | SCRUM-331, 332: provider buttons, callback screen, account linking controls |
| `feat/lot-15-auth-regression-validation` | SCRUM-89, 90, 444 and cross-lot regressions; existing registration/login/2FA coverage retained |

The final branch contains the complete local implementation. The original 24
remaining tickets are covered by these lots; real provider setup is tracked
separately in SCRUM-534. Local implementation is not a production deployment or
evidence that a provider application has been configured.

## Session contract

- Existing `POST /v1/auth/login` and `POST /v1/auth/2fa/verify` response shapes are
  unchanged. JWT claims additionally contain `jti` and `typ: access`.
- `GET /v1/users/me` requires a verified, unexpired, non-revoked bearer session.
  It returns public account/statistic fields and the current user's email. Secrets
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
Real Google/GitHub account consent and provider-console configuration still need
the manual acceptance tracked by SCRUM-534.

## Pending integration with the profile branch

`origin/feat/s3-scrum-95-profile` contains Erwan's separate, unmerged implementation
of `/v1/users/me` (commit `9582d0f`). Its `AccessTokenGuard` accepts the previous
stateless JWT shape and rejects `typ: access`. Do not blindly combine the two
controllers or register both routes. SCRUM-535 tracks reusing `UsersController`
and its profile projection with the shared revocable-session guard while
preserving that commit and its tests. This local branch stack has not merged or
modified Erwan's branch. An explicit local-merge approval was requested.
