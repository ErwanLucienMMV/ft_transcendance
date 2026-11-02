# Docker operation

SCRUM-510 · Commands below run from the repository root.

## Start and inspect production

Install Docker with Compose v2 (or a compatible Podman Compose provider), Make,
and a container engine with enough space for the Angular, NestJS and C++ builds.

```sh
make env
# Edit srcs/.env for this deployment before starting.
docker compose -f srcs/docker-compose.yml config --quiet
make full
docker compose -f srcs/docker-compose.yml ps
curl -k https://localhost:8080/api/v1/health
```

`make full` builds and starts the application, imports the bundled puzzle
catalogue through the rules engine, then starts the independent backup service.
Use `make` for the application alone; start backups afterwards with `make backup`.
Build failures are reported in `compose.log`; NestJS health failures also print
the latest API logs. `-k` is for the local self-signed certificate only.

The example environment uses HTTPS port 8080 and HTTP redirect port 80. Set
`HTTPPORT` to an unprivileged free port (for example 8088) for rootless engines.
Set `APPURL` to the actual browser URL. Keep `APIPORT=3000` and
`DATABASE_PORT=5432` for production: the Nginx upstream, API healthcheck and
container database connection currently use these internal ports.

## Services and traffic

| Service | Role | Access in production Compose |
| --- | --- | --- |
| nginx | Angular static files, TLS, API/WS/Grafana proxy | Host HTTPPORT and APPPORT |
| nestjs | REST API and authenticated WebSockets | Internal 3000; `/api/` strips the prefix, `/ws` is upgraded |
| postgres | Application persistence | Internal 5432 and host DATABASE_PORT |
| forgemail | Verification email delivery | Internal 3002; health-gated before API starts |
| chess-engine | Chess rule validation | Internal WebSocket 8081 |
| bot | Computer opponent | Internal WebSocket 8082 |
| prometheus | Metrics collection | Host 9090 |
| grafana | Dashboards | Internal 3000, browser `/grafana/` |
| backup | Independent hourly PostgreSQL dumps | Joins the existing transcendence network |

The application network is named `transcendence`. Nginx waits for healthy
NestJS, which waits for healthy PostgreSQL and forgemail. The database and
Prometheus ports are currently published; restrict access at the host firewall
when deploying beyond local development.

## Persistent storage and safe restarts

PostgreSQL, Prometheus and Grafana use `postgres_data`, `prometheus_data` and
`grafana_data` volumes. The separate backup project uses
`transcendence_backup_data`, mounted at `/backups`.

```sh
docker compose -f srcs/docker-compose.yml logs --tail 100 nestjs forgemail
docker compose -f srcs/docker-compose.yml restart nestjs
make backup-logs
```

`restart` does not apply changed container environment settings. After editing
`.env`, run `make` to recreate affected services. Database initialization runs
only on an empty PostgreSQL data volume: changing database credentials in `.env`
does not change existing database roles. Coordinate a database-side credential
change instead of deleting the volume.

`make down` stops/removes containers and networks without requesting volume
removal. `make clean` and `make re` request volume deletion, including backup
history; do not use them as routine restart commands. Recovery procedures and
the hourly/24-hour retention policy are in [BACKUP.md](../BACKUP.md).

## Development and isolated tests

`make dev` uses `srcs/docker-compose.dev.yml`: Angular on 4200 and NestJS on
APIPORT, with source bind mounts and an Angular proxy. It has no Nginx TLS
entry point. Production and development use fixed container names, so run one
application stack at a time.

`make test` runs the bot, isolated backend and mail suites. Backend test Compose
has its own project name, `postgres-test` with tmpfs storage, and loopback ports
55432/55433/55434 for database/rules/bot. Never point these tests at application
data. `make test-puzzles` runs the focused puzzle suites.

## Source of truth

- [Production Compose](../srcs/docker-compose.yml)
- [Development Compose](../srcs/docker-compose.dev.yml)
- [Makefile](../Makefile), [test Compose](../srcs/nestJS/42chess/test/docker-compose.yml)
- [Nginx configuration](../srcs/angular/conf/nginx.conf)
