# OAuth sign-in: Google, GitHub and 42

SCRUM-520 · Applies to the provider implementation in `srcs/nestJS/42chess/src/oauth`.

## Configure a provider

Create an OAuth application in the chosen provider's console. Set these in
`srcs/.env` using that application's credentials:

```dotenv
APPURL=https://chess.example
GOOGLE_CLIENT_ID=<google-application-id>
GOOGLE_CLIENT_SECRET=<google-application-secret>
GOOGLE_CALLBACK_URL=https://chess.example/api/v1/auth/oauth/google/callback
GITHUB_CLIENT_ID=<github-application-id>
GITHUB_CLIENT_SECRET=<github-application-secret>
GITHUB_CALLBACK_URL=https://chess.example/api/v1/auth/oauth/github/callback
FORTYTWO_CLIENT_ID=<42-application-uid>
FORTYTWO_CLIENT_SECRET=<42-application-secret>
FORTYTWO_CALLBACK_URL=https://chess.example/api/v1/auth/oauth/fortytwo/callback
```

For a local stack, `srcs/configure-oauth-local.sh google|github|42` asks for
one provider's id and secret and writes them to `srcs/.env`. The 42
application is created on the intranet (Settings, API, *Register a new app*).

Configure the same exact callback URL in each provider console. Include the
public HTTPS port if it is nonstandard. Callback variables may be empty: Nest
derives them from the public origin. When set, they must match exactly, including
scheme, host, port, path and trailing slash. Google scopes are `openid email
profile`; GitHub scopes are `read:user user:email`; 42 uses `public` and reads
`https://api.intra.42.fr/v2/me`.

Both the client id and secret are required. Each provider is enabled
independently; `/api/v1/auth/oauth/providers` returns `{ providers: [...] }` and
the frontend shows only enabled buttons. No secrets are returned to the browser.
Run `make env` to see configuration warnings, then `make` to apply changed
container environment. Nest startup logs explain which providers are enabled
or why they are hidden.

The OAuth origin is OAUTH_PUBLIC_URL when non-empty, otherwise APPURL. It must
be a bare HTTPS origin, without credentials, query, fragment or a non-root path.
HTTP is accepted only for exact hosts `localhost` and `127.0.0.1`. For Angular
development use `OAUTH_PUBLIC_URL=http://localhost:4200` and register callbacks
under that origin. A provider may impose its own local callback restrictions.
The production Compose file forwards GOOGLE_*/GITHUB_*/FORTYTWO_* variables;
OAUTH_GOOGLE_*/OAUTH_GITHUB_*/OAUTH_FORTYTWO_* aliases are accepted by Nest when
injected directly.

## Browser flow

1. The browser navigates to `/api/v1/auth/oauth/google`, `/github` or `/fortytwo`. Nest
   creates a five-minute, browser-bound flow with state and a PKCE verifier,
   sets an httpOnly `oauth_browser` cookie and redirects to the provider.
2. The provider returns to the registered API callback with `state` and `code`.
   Nest checks and consumes the flow, exchanges the code server-side and
   verifies provider identity. Provider access tokens never enter browser URLs.
3. Nest sets an httpOnly `oauth_handoff` cookie valid for one minute and redirects
   to the Angular `/oauth/callback` page. It does not put a session token in
   the redirect URL.
4. Angular POSTs `/api/v1/auth/oauth/exchange` with credentials and
   `X-OAuth-Exchange: 1`. Nest consumes the handoff and browser cookies and
   clears them. The response establishes the normal session, or a 2FA
   challenge when the account requires it.
5. A new account takes the provider's login as its username when it is free
   and valid (otherwise with a number appended) and its picture, then lands on
   `/settings?welcome=1`, where the player can change both.

The sign-in page tells the player, under the provider buttons, that creating an
account this way accepts the Terms of Service and the Privacy Policy. The start,
callback, link and exchange routes share the strict sign-in budget of Nginx
([HTTP rate limits](http-rate-limiting.md)).

Flow cookies use SameSite=Lax and Secure on HTTPS, with path `/`. State and
handoff records are one-use and browser-bound. A copied callback URL, expired
flow or replay cannot establish another browser's session. Use the same browser
and public origin for the entire flow.

## Existing accounts and linking

A matching email does not silently link an existing account. The callback page
can report `existing-account`: sign in with the existing method first, then
link the provider from Settings, *Sign-in methods*. This preserves identity ownership.

Authenticated API routes are:

| Route | Purpose |
| --- | --- |
| GET `/api/v1/auth/oauth/accounts` | List caller's linked providers |
| POST `/api/v1/auth/oauth/:provider/link` | Returns authorizationUrl and sets browser flow cookie |
| DELETE `/api/v1/auth/oauth/:provider` | Unlink caller's provider; returns 204 |

Linking remains bound to the authenticated account/session. Unlinking cannot
remove the last usable sign-in method. Google identities require verified
email before using it; GitHub reads primary verified email from its email API;
42 addresses are school addresses, verified by the school.
Provider identity ownership is enforced by database uniqueness.

## Troubleshooting and verification

| Symptom | Evidence to inspect |
| --- | --- |
| Button absent | `/api/v1/auth/oauth/providers`, Nest startup diagnostics, complete credentials and exact callback |
| Provider rejects redirect | Compare provider console URL with the generated public callback character for character |
| Callback says failed/expired | Restart sign-in; check same origin/browser, flow cookies, time window and provider response |
| Existing account error | Sign in normally and link explicitly |
| Configuration edited but still hidden | Recreate affected container with `make`; restart alone retains old environment |

Run backend checks from `srcs/nestJS/42chess`:

```sh
npm test -- src/oauth/oauth-provider.spec.ts
npm run build
./node_modules/.bin/vitest run --config vitest.config.e2e.ts test/oauth.e2e-spec.ts
```

The acceptance suite needs the dedicated test PostgreSQL fixture and uses a
controlled provider HTTP adapter. It verifies state, PKCE, identity ownership,
replay, linking/unlinking and 2FA; it does not establish live provider-console
configuration. Complete a manual sign-in/link/unlink check with each configured
provider before deployment. Never paste client secrets or callback codes into
an issue or shared log.

Sources: [provider configuration](../srcs/nestJS/42chess/src/oauth/oauth-provider.ts),
[controller](../srcs/nestJS/42chess/src/oauth/oauth.controller.ts),
[flow service](../srcs/nestJS/42chess/src/oauth/oauth.service.ts),
[callback page](../srcs/angular/42chess/src/app/features/auth/oauth-callback-page.ts).
