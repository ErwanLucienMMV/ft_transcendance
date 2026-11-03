# Environment reference

SCRUM-511 · The tracked template is [srcs/.env.example](../srcs/.env.example).
Run `make env` from the repository root to create `srcs/.env` and generate
missing secrets. Existing non-empty values are preserved. Keep the real file
out of Git; use placeholders in reports and examples.

## Application and database

| Variable | Example/default | Meaning |
| --- | --- | --- |
| APIPORT | 3000 | API listener; keep 3000 in production because Nginx and healthcheck use it |
| CORS_ORIGINS | empty | Comma-separated exact additional browser origins; same-origin Nginx needs none |
| DATABASE_HOST | postgres | Compose PostgreSQL service DNS name; use loopback for host-side tools |
| DATABASE_PORT | 5432 | Database connection port and production host publication; keep 5432 internally |
| DATABASE_NAME | transcendence | Application database |
| DATABASE_USER | transcendence | Application database role |
| DATABASE_PASSWORD | generated | Required non-empty database password |
| POSTGRES_BACKUP_USER | MyNameIsBob | Read role initialized with the database |
| POSTGRES_BACKUP_PASSWORD | generated | Password for independent backup container |
| APPPORT | 8080 | Published HTTPS port |
| HTTPPORT | 80 | Published HTTP redirect port; use a free port >=1024 for rootless engines |
| APPURL | https://localhost:${APPPORT} | Public browser origin and email-link base; Compose expands APPPORT |

Nest validates API/database ports as integers 1–65535 and requires non-empty
database host, name, user and password. Initial database roles are created only
on an empty volume. Editing this file later does not change stored role
passwords; update the database role and dependent services together.

## Authentication

| Variable | Default | Meaning |
| --- | --- | --- |
| JWT_SECRET | generated | At least 32 characters; signs access tokens |
| JWT_EXPIRES_IN | 3600 | Positive access-token lifetime in seconds |
| REFRESH_EXPIRES_IN | 604800 | Positive refresh-session lifetime in seconds; renewed on refresh |
| OAUTH_PUBLIC_URL | APPURL | Optional public OAuth origin; HTTP allowed only for localhost/127.0.0.1 |
| GOOGLE_CLIENT_ID | empty | Google OAuth application id |
| GOOGLE_CLIENT_SECRET | empty | Google server-side application secret |
| GOOGLE_CALLBACK_URL | derived | Empty or exactly `<public origin>/api/v1/auth/oauth/google/callback` |
| GITHUB_CLIENT_ID | empty | GitHub OAuth application id |
| GITHUB_CLIENT_SECRET | empty | GitHub server-side application secret |
| GITHUB_CALLBACK_URL | derived | Empty or exactly `<public origin>/api/v1/auth/oauth/github/callback` |

Origins cannot contain credentials, query, fragment or a path other than `/`.
Both id and secret are required to enable a provider. Nest also accepts
`OAUTH_GOOGLE_CLIENT_ID`/`OAUTH_GOOGLE_CLIENT_SECRET` and corresponding GitHub
aliases, preferring them over legacy names when both are supplied. The shipped
Compose files forward the legacy names; use those in `srcs/.env`.
For development through Angular's proxy, set OAUTH_PUBLIC_URL to
`http://localhost:4200`. Provider console redirect URLs must exactly match.

## Mail and monitoring

| Variable | Default/template | Meaning |
| --- | --- | --- |
| SMTP_HOST | smtp.gmail.com | SMTP server |
| SMTP_PORT | 465 | SMTP port (implicit TLS on 465) |
| SMTP_USER | empty | SMTP login |
| SMTP_PASSWORD | empty | SMTP password/app password |
| MAIL_FROM | SMTP_USER or local fallback | Email sender, optionally `Name <address>` |
| GF_SECURITY_ADMIN_USER | generated as admin | Grafana initial administrator name |
| GF_SECURITY_ADMIN_PASSWORD | generated | Grafana initial administrator password |

Forgemail uses SMTP only when both login fields are non-empty; otherwise it
logs verification email messages. `FORGEMAIL_PORT` defaults to 3002 in the mail
service itself but is not forwarded by the shipped Compose file.

## Internal services and tests

Production Compose supplies `MAIL_SERVICE_URL=http://forgemail:3002`,
`CHESS_ENGINE_URL=ws://chess-engine:8081` and `BOT_ENGINE_URL=ws://bot:8082`
directly. Changing `srcs/.env` alone does not override these fixed entries.

The isolated backend test stack uses TEST_DATABASE_HOST/TEST_DATABASE_PORT,
TEST_CHESS_ENGINE_URL and TEST_BOT_ENGINE_URL. Host port defaults are
55432/55433/55434. Test database credentials are dedicated fixtures, not the
application credentials. Vitest ignores developer dotenv files.

## Loading and applying changes

Nest's process environment takes precedence over a local `.env`, then
`srcs/.env` for host-side npm commands. Compose interpolates its file from the
Compose project directory and explicitly forwards settings to each container;
an arbitrary key in `.env` is not automatically exported to every service.

`make env` also runs `srcs/check-env.sh`, which reports URL, SMTP and OAuth
configuration issues without printing passwords. It warns without blocking
startup. Run `make` after editing configuration so Compose recreates affected
containers; a plain container restart retains the old environment. Grafana
initial admin settings do not reset an administrator already stored in its volume.

Validate interpolation with `docker compose -f srcs/docker-compose.yml config --quiet`.
Avoid sharing full `config` output because expanded secrets can appear there.

Sources: [environment validator](../srcs/nestJS/42chess/src/config/environment.ts),
[OAuth provider configuration](../srcs/nestJS/42chess/src/oauth/oauth-provider.ts),
[mail configuration](../srcs/forgemail/src/config.js),
[production Compose](../srcs/docker-compose.yml), [init script](../srcs/init-env.sh).
