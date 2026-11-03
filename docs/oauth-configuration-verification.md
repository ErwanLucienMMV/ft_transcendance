# OAuth configuration verification — SCRUM-495 / SEC-14

Review date: 2 November 2026. Base: `origin/dev_test` at `062aaa6`.
Reuses the tests from existing commit `11df85f`; its branch remains intact.

Google and GitHub configuration already fails closed. No production OAuth
behavior needed changing. The new `oauth-configuration.spec.ts` adds 21 cases:

- Compose's `GOOGLE_*` and `GITHUB_*` credentials work; direct configuration
  with `OAUTH_*_CLIENT_ID`/`OAUTH_*_CLIENT_SECRET` takes precedence.
- A provider missing either credential is disabled independently of another
  correctly configured provider, without making an external request.
- Empty, insecure non-local, credential-bearing, path-bearing, query-bearing,
  fragment-bearing and non-HTTP(S) public URLs disable sign-in. Lookalike
  localhost domains are rejected. Error responses do not reveal credentials.
- HTTP on `localhost` and `127.0.0.1` supports development; HTTPS supports
  deployment. `OAUTH_PUBLIC_URL` overrides `APPURL`, and an explicitly unsafe
  value does not silently fall back to a different origin.
- Optional `GOOGLE_CALLBACK_URL` and `GITHUB_CALLBACK_URL` must match the
  generated public callback exactly, including scheme, path and trailing slash.

Production Compose passes the legacy provider credential/callback names to
NestJS. Configure `APPURL` or `OAUTH_PUBLIC_URL` to the browser-visible origin,
then register these exact callback URLs with the provider:

```text
<public origin>/api/v1/auth/oauth/google/callback
<public origin>/api/v1/auth/oauth/github/callback
```

## Sign-in with 42

The 42 provider added later uses the same code path: `FORTYTWO_*` variables
(or `OAUTH_FORTYTWO_*`), the same public-origin checks and an exact
`<public origin>/api/v1/auth/oauth/fortytwo/callback`. The provider cases of
`oauth-configuration.spec.ts` run for Google, GitHub and 42.

## Validation

The configuration and provider unit suites passed: **32 tests in two files**.
`git diff --check` passed. Vite reports its existing TypeScript path-plugin notice.
Database/HTTP acceptance and live provider sign-in have not been rerun for this
branch; commands below document how to run the additional checks.

From `srcs/nestJS/42chess`, after the build and with the dedicated database fixture:

```sh
./node_modules/.bin/vitest run src/oauth
./node_modules/.bin/vitest run --config vitest.config.e2e.ts test/oauth.e2e-spec.ts
./node_modules/.bin/oxlint --type-aware src/oauth/oauth-configuration.spec.ts
./node_modules/.bin/prettier --check src/oauth/oauth-configuration.spec.ts ../../../docs/oauth-configuration-verification.md
git diff --check
```

Tests use fixture credentials and a controlled provider HTTP adapter. No actual
Google/GitHub credentials were read, changed or used; live provider-console
registration and production sign-in were not verified. The existing Vite
TypeScript path-plugin notice remains. No Jira item or production configuration
was changed.
