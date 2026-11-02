# srcs

Every service of 42 Chess, and the Compose files that run them. Use the `Makefile` at the
repository root rather than these files directly: it creates `srcs/.env` first (`make env`).

| Folder | Service |
| --- | --- |
| `angular/` | Angular front end; in production, nginx serves it and proxies `/api` and `/ws` to the API (`angular/conf/nginx.conf`). |
| `nestJS/42chess/` | NestJS API and WebSocket gateway. |
| `chess-engine/` | C++ rules engine (WebSocket). |
| `bot/` | C++ computer opponent (WebSocket). |
| `forgemail/` | Email service (verification, password and alert emails). |
| `postgreSQL/` | PostgreSQL 15 image and its initialisation. |
| `prometheus/`, `alertmanager/`, `grafana/` | Monitoring, alerts and dashboards (see `DOC_MONITORING.md`). |

## Production

```bash
make            # docker compose -f srcs/docker-compose.yml up --build -d, then the puzzle import
```

The site is served by nginx over HTTPS on `APPPORT` (default `https://localhost:8080`). Only
nginx publishes ports; the database, the API and the monitoring stay on the Docker network.

## Development

```bash
make dev        # docker compose -f srcs/docker-compose.dev.yml up --build
```

There is no nginx in development. The Angular development server runs on
`http://localhost:4200` with hot reload and proxies `/api` and `/ws` to the API, which runs on
`http://localhost:3000` in watch mode. Both ports are bound to `127.0.0.1` only. For OAuth in
development, set `OAUTH_PUBLIC_URL=http://localhost:4200` in `srcs/.env`.
