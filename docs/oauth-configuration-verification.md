# OAuth configuration verification — SCRUM-495 / SEC-14

Review date: 31 October 2026. Base: `origin/dev_test` at `b49b735`.

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

## Validation

All **31 unit cases** in the OAuth directory passed (21 configuration cases
plus 10 existing provider-protocol cases). Lint of the new test file passed
without errors or warnings. Formatting and `git diff --check` passed.

The existing PostgreSQL/HTTP OAuth acceptance suite was rerun separately:
**12 passed**, verifying durable identity ownership, browser-bound flow state,
PKCE, replay/expiry rejection, authenticated linking, concurrent unlink safety,
2FA enforcement and token handoff. The full backend build and contract checks
also passed during this session.

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
