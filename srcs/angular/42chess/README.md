# 42chess

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.1.8.

## Development server

To start a local development server, run:

```bash
NG_ALLOWED_HOSTS=localhost,127.0.0.1 ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

## Lot 1 implementation

Covers FRONT-02, FRONT-04, FRONT-07, FRONT-08 and FRONT-AUTH-01..02
(SCRUM-319, 321, 324, 325, 326, 327).

- Public routes: `/`, `/login`, `/register`; unknown routes show a not-found page.
  Known pages remain prerendered. Nginx falls back to Angular's `index.csr.html`
  for other URLs, so client routing does not hydrate the home page's HTML as
  a different page. Prerendered directories are resolved to their `index.html`
  directly, avoiding slash redirects that lose the externally published HTTPS
  port when it differs from 443.
- `core/api/ApiClient` sends typed JSON requests to the same-origin `/api/v1`
  prefix that production Nginx forwards to NestJS `/v1`. Use relative endpoint
  paths and the `params` option for queries. `API_BASE_URL` is injectable.
- The HTTP interceptor preserves the backend `statusCode/code/message/details`
  error shape in `ApiError`. Network and server failures also show a dismissible
  global message. Business errors remain available to the requesting feature.
  Requests are not automatically retried, and raw server diagnostics are not
  displayed in the global message.
- Unexpected Angular errors are logged through `GlobalErrorHandler` and show
  a generic message. Existing browser error listeners and hydration are retained.
- Login and registration forms validate the existing DTO field limits. Login
  accepts either a username or email; passwords are never trimmed. Registration
  checks password confirmation locally and emits only the three API fields.
  Password lengths are counted like the backend's class-validator `@Length` (an
  emoji counts once). Password inputs have no native `minlength`/`maxlength`:
  browsers count UTF-16 code units there, and Chromium truncates text replacing a
  selection in a masked field. The form validator and the API bound the length.

The forms are presentation components with `submissionEnabled`, `pending` and
`submitted` inputs/output. The routed pages keep submission disabled until lot 3
connects the real authentication service. There is no simulated login, stored
token or new authentication guard in this lot. No request is made during
prerendering. The Figma theme and images are deferred; CSS provides structure
and keyboard focus only.

The development Compose stack currently has no Nginx. When connecting APIs,
configure an Angular development proxy or explicitly provide the appropriate
API origin and the backend CORS allowlist; `/api/v1` otherwise refers to the
Angular development server. Production continues to use Nginx.

Validate from this directory with the locked dependencies and Node 22:

```bash
npm ci
npm test -- --watch=false
npm run build
```

No dependency, lockfile, test configuration or CI workflow change is required
for this lot. CI execution of the Angular test suite is tracked in lot 2.

## Lot 2 browser tests and CI

Adds Playwright 1.64.0 as a development dependency, without changing existing
locked package versions or the Angular unit test configuration. The separate
`Frontend validation` workflow runs all Angular tests, the production build and
browser E2E. The original CI workflow remains unchanged.

```bash
# Repo root: isolated PostgreSQL, API, test-only mail capture and Chromium.
docker compose -f srcs/angular/compose.e2e.yml run --rm --build browser-tests
docker compose -f srcs/angular/compose.e2e.yml down
```

The test project publishes no host ports and uses an ephemeral database. The
mail capture is test infrastructure, never a production mail endpoint. Browser
tests exercise actual page navigation and form validation; registration/login
against the real API are added in lot 3. Screenshots, traces and reports are
ignored by Git. Locally, after installing Playwright's Chromium, `npm run
test:e2e` starts its own Angular server and runs the same browser tests.
The browser runner authorizes only `localhost` and `127.0.0.1` for Angular's
Node SSR handler. Development build configuration has the same explicit host
allowlist; production host restrictions are unchanged.

## Lot 3 local authentication

SCRUM-328, 329, 322, 333, 334, 456 and 467: forms now call the existing
registration/login API. Registration requires the emailed verification link
before login; `/verify-email` handles the mail service's existing URL and offers
resending with a neutral response. `/two-factor` accepts the six-digit TOTP
after a password challenge; the challenge is kept in memory, never in a URL.
These routes and `/session` use client rendering to avoid authentication requests
during prerendering. `/session` is a minimal guarded session view, not the profile
feature. Business errors stay local, pending submissions cannot be duplicated,
and subscriptions are cancelled when the page is destroyed.

The access token and public user stay in memory. Reloading requires login again
until Nicolas's `/users/me` and session integration are available. The client
decodes only `exp` for expiry UX; server JWT verification remains mandatory.
The interceptor attaches a bearer only to this API's private routes. A protected
401 clears the corresponding session and redirects to a validated local URL;
wrong login/2FA credentials do not trigger that redirect. Old requests cannot
clear a newer session. No password or token is persisted or logged.

Development requests to `/api/v1` are proxied to NestJS `/v1`. Set
`API_PROXY_TARGET` when the API is elsewhere (development Compose supplies its
internal service address). Production uses the existing Nginx proxy.
The isolated browser suite exercises real registration, unverified refusal,
email verification, wrong-password refusal, login and anonymous route protection.
JWT guard, server logout, OAuth and `/users/me` are still server dependencies.

## Lot 9 Figma visual integration

`feat/lot-9-figma-ui` applies the supplied PNG's dark/lime visual direction to
the shared header/footer, landing page, login, registration, email verification,
2FA, session and not-found pages. Form validation, requests and guards remain
the existing implementations. Registration/email/2FA/mobile states extend the same visual language because the PNG contains no such frames.
The main layout collapses at 700px; authentication cards adapt below 600px.
Focus indicators, visible labels, field errors and reduced-motion preferences
are retained. Fonts use local system fallbacks without a font service request.

Chess pieces are original local SVG symbols. The landing board is an illustrative
opening position, not the live chess component. Landing links lead to working
authentication routes; player counts, rankings and matchmaking are not
simulated for presentation. Game/profile/history screens remain their separate
frontend backlog. The welcome heading is retained for assistive technology while
the visible header uses the Figma-style wordmark.

Actual Chromium screenshots are saved outside the source tree in
`outputs/figma_preview_2026-10-16/` (desktop and mobile). The local preview started
for visual review listens on `http://localhost:4300`; it uses the isolated E2E
API/mail/database fixtures, so verification emails are captured rather than sent.
The original Figma PNG and other local documents remain untouched and untracked.
The guarded 2FA screenshot uses a browser-scoped challenge response fixture;
it does not enable a fake login mode in the application. Visual QA checks five
public routes at 320, 360, 390, 768, 1024 and 1440px, including horizontal overflow
and the illustration's 64 equal square cells.

This review branch (`feat/lot-9-figma-ui-standalone`) starts from lot 6 and
applies the visual changes from `61dba0c`. Lots 7 and 8 are not included: the
header keeps the existing public navigation and the login page has no OAuth
entry. Their original branches and commits are preserved for later integration.
