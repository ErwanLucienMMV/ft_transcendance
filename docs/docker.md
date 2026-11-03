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

`make` builds and starts the application, then imports the bundled puzzle
catalogue through the rules engine. `make full` does the same, then starts the
independent backup service; with `make` alone, start backups afterwards with
`make backup`.
Build failures are reported in `compose.log`; NestJS health failures also print
the latest API logs. `-k` is for the local self-signed certificate only.

The example environment uses HTTPS port 8080 and HTTP redirect port 80. Set
`HTTPPORT` to an unprivileged free port (for example 8088) for rootless engines.
Set `APPURL` to the actual browser URL. `APIPORT` may change: the Nginx
upstream, the API healthcheck and Prometheus follow it. Keep `DATABASE_PORT=5432`,
the port PostgreSQL listens on inside the network (the backup service uses it too).

## Services and traffic

| Service | Role | Access in production Compose |
| --- | --- | --- |
| nginx | Angular static files, TLS, API/WS/Grafana proxy | Host HTTPPORT and APPPORT |
| nestjs | REST API and authenticated WebSockets | Internal 3000; `/api/` strips the prefix, `/ws` is upgraded |
| postgres | Application persistence | Internal 5432 |
| forgemail | Verification, password-reset and alert emails | Internal 3002; health-gated before API starts |
| chess-engine | Chess rule validation | Internal WebSocket 8081 |
| bot | Computer opponent | Internal WebSocket 8082 |
| prometheus | Metrics collection and alert rules | Internal 9090 |
| alertmanager | Sends firing alerts to forgemail | Internal 9093 |
| node-exporter, cadvisor, postgres-exporter | Machine, container and database metrics | Internal, scraped by Prometheus |
| grafana | Dashboards | Internal 3000, browser `/grafana/` |
| backup | Independent hourly PostgreSQL dumps | Joins the existing transcendence network |

The application network is named `transcendence`. Nginx waits for healthy
NestJS, which waits for healthy PostgreSQL and forgemail. Only Nginx publishes
ports: the database, Prometheus, Alertmanager and the exporters are reachable
from the network alone, and Nginx answers 404 for the API's metrics. Monitoring
is described in [DOC_MONITORING.md](../DOC_MONITORING.md).

## Persistent storage and safe restarts

PostgreSQL, Prometheus, Alertmanager and Grafana use `postgres_data`,
`prometheus_data`, `alertmanager_data` and `grafana_data` volumes; uploaded
pictures live in `avatars`. The separate backup project writes to `backups/` at
the repository root (BACKUP_DIR), a host folder outside every volume, with the
time of the last success in `backups/status/last-success`.

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

`make down` and `make clean` stop and remove containers and networks; `make re`
rebuilds after `clean`. They keep every volume and the backups. `make fclean`
also deletes the volumes (database, metrics, dashboards, pictures) after a
confirmation, and still keeps `backups/`. `make backup-now` takes a backup at
once, `make backups` lists them and `make restore BACKUP=<file>` restores one
with the application stopped. Recovery procedures and the retention policy are
in [BACKUP.md](../BACKUP.md).

## Development and isolated tests

`make dev` uses `srcs/docker-compose.dev.yml`: Angular on 4200, NestJS on
APIPORT, Grafana on 3001, Prometheus on 9090 and PostgreSQL on 5432, bound to
127.0.0.1, with source bind mounts and an Angular proxy. It has no Nginx TLS
entry point. Production and development use fixed container names, so run one
application stack at a time.

`make test` runs the bot, isolated backend and mail suites. Backend test Compose
has its own project name, `postgres-test` with tmpfs storage, and loopback ports
55432/55433/55434 for database/rules/bot. Never point these tests at application
data. `make test-puzzles` runs the focused puzzle suites and
`make check-monitoring` checks the Prometheus, Alertmanager and Grafana files.

## Source of truth

- [Production Compose](../srcs/docker-compose.yml)
- [Development Compose](../srcs/docker-compose.dev.yml)
- [Makefile](../Makefile), [test Compose](../srcs/nestJS/42chess/test/docker-compose.yml)
- [Nginx configuration](../srcs/angular/conf/nginx.conf)
