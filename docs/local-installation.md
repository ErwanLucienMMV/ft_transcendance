# Local installation

SCRUM-509 · Run commands from the repository root unless noted otherwise.

## Prerequisites

- Git, Make and a running Docker engine with Compose v2 (or compatible Podman).
- Free ports 8080 (HTTPS), 80 (HTTP redirect), 5432 (PostgreSQL) and 9090
  (Prometheus) for production. Development additionally uses 4200 and 3000;
  Grafana is published on 3001 in development.
- Node 22 and npm for running backend tools on the host; container builds bring
  their own Node toolchain. Use the Angular package's supported Node version if
  developing the frontend outside its Node 22 container.

## First startup

```sh
make env
```

This creates `srcs/.env` from the tracked example if absent, fills missing
secrets and preserves non-empty values. Edit that file before starting:

- Keep `DATABASE_HOST=postgres`, `DATABASE_PORT=5432`, `APIPORT=3000` for the
  production Compose network.
- Set `APPURL=https://localhost:8080` for local use, or the actual public origin.
  `APPPORT` is the HTTPS host port. On rootless engines change `HTTPPORT=80` to
  a free unprivileged port such as 8088.
- Set SMTP credentials and MAIL_FROM to deliver verification mail. Without a
  complete SMTP login, forgemail logs mail instead; inspect its logs locally
  for the verification link. Do not share those links or logs publicly.
- OAuth credentials are optional; unconfigured providers have hidden buttons.

```sh
docker compose -f srcs/docker-compose.yml config --quiet
make full
docker compose -f srcs/docker-compose.yml ps
curl -k https://localhost:8080/api/v1/health
```

Open `https://localhost:8080`, accept the local self-signed certificate, register
and verify your email. `make full` imports puzzles and starts the independent
backup service after the application is healthy. `make` starts only the main
stack and puzzle import. Use `-k` only for local certificate checks.

## Development with live reload

Stop the production stack before starting development: both Compose files use
fixed container names. `docker compose -f srcs/docker-compose.yml down` removes
containers/network without requesting volume deletion; a running backup attached
to that network may require stopping its Compose project first.

```sh
make dev
```

Open `http://localhost:4200`. The Angular proxy sends `/api` and `/ws` to
NestJS. For OAuth development set `OAUTH_PUBLIC_URL=http://localhost:4200` and
register that exact callback origin with the provider. Development uses source
bind mounts and dependency volumes refreshed when lockfiles change.

To run NestJS tools on the host, install with `npm ci` in
`srcs/nestJS/42chess`, then supply host database/rules/bot addresses as needed;
Compose service names resolve only inside its network. Do not aim test commands
at the application database.

## Validation

```sh
make test
make test-puzzles
```

The backend test stack uses `transcendence_test`, temporary PostgreSQL storage
and separate rules/bot services. Host defaults are 55432, 55433 and 55434; the
test Compose file supports TEST_DATABASE_PORT, TEST_CHESS_ENGINE_PORT and
TEST_BOT_ENGINE_PORT overrides. Backend local commands are `npm test`,
`npm run build`, `npm run test:contracts`, `npm run test:db`, `npm run test:e2e`.
The last two require the isolated test services; E2E also needs a built backend.

For frontend checks, run `npm ci`, `npm run build`, `npm test -- --watch=false`
and `npm run test:e2e` from `srcs/angular/42chess`. Browser tests require the
Playwright browsers and follow the configuration in
[playwright.config.ts](../srcs/angular/42chess/playwright.config.ts).

## Troubleshooting without losing data

| Symptom | Check |
| --- | --- |
| Port already allocated | Inspect host listeners and stop the conflicting stack; avoid changing container-internal ports |
| Nginx not started | `docker compose -f srcs/docker-compose.yml logs --tail 100 nestjs` and service health |
| Registration email fails | `docker compose -f srcs/docker-compose.yml logs --tail 100 forgemail`; verify SMTP login/app password |
| OAuth button absent | Run `make env` and read NestJS startup diagnostics; provider id, secret and exact public callback must agree |
| Database login fails after editing .env | Existing database roles retain their original password; coordinate a role update |
| Build fails | Read `compose.log` and fix the reported step; do not bypass tests |

`make clean` and `make re` remove persistent volumes. They are destructive and
must not be used to fix installation problems. See [backup and recovery](../BACKUP.md)
before any database recovery operation.

Sources: [Makefile](../Makefile), [example environment](../srcs/.env.example),
[production Compose](../srcs/docker-compose.yml),
[development Compose](../srcs/docker-compose.dev.yml).
