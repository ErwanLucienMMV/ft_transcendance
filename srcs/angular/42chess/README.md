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
