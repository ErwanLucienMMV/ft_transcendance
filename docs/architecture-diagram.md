# Deployment architecture diagram

SCRUM-522 · Matches `srcs/docker-compose.yml` and the separate backup project
(updated 2 November 2026). See the [standalone SVG](architecture-diagram.svg)
for a portable, zoomable diagram.

```mermaid
flowchart TB
  browser[Browser - Angular application]
  providers[Google, GitHub and 42]
  smtp[SMTP server]
  subgraph main[Main Compose project - transcendence network]
    nginx[Nginx - TLS and static Angular]
    api[NestJS API and native WebSockets]
    db[(PostgreSQL)]
    rules[C++ chess rules engine]
    bot[C++ bot service]
    mail[forgemail]
    prom[Prometheus]
    alerts[Alertmanager]
    exporters[node, cAdvisor and PostgreSQL exporters]
    grafana[Grafana]
    data[(postgres_data)]
    pictures[(avatars)]
    metrics[(prometheus_data and alertmanager_data)]
    dashboards[(grafana_data)]
    nginx -->|/api/ and /ws| api
    nginx -->|/grafana/| grafana
    api -->|transactions| db
    api -->|WebSocket 8081| rules
    api -->|WebSocket 8082| bot
    api -->|HTTP 3002| mail
    prom -->|scrape metrics| api
    prom -->|scrape| exporters
    exporters -->|read-only| db
    prom -->|firing alerts| alerts
    alerts -->|webhook| mail
    grafana -->|query| prom
    db --- data
    api --- pictures
    prom --- metrics
    grafana --- dashboards
  end
  subgraph recovery[Independent backup Compose project]
    backup[Hourly pg_dump and manual restore]
    archives[(backups/ host folder)]
    backup --- archives
  end
  browser -->|HTTPS APPPORT - HTTPPORT redirects| nginx
  browser -->|OAuth redirects| providers
  api -->|server-side token and identity requests| providers
  mail --> smtp
  backup -->|external transcendence network - PostgreSQL 5432| db
  api -->|reads last backup time| archives
```

Nginx strips `/api` before forwarding to NestJS, preserves `/ws` for upgrades
and serves the built Angular application. Every other service is internal: only
Nginx publishes ports (HTTPPORT and APPPORT). Grafana is reached through Nginx,
and the API's metrics are refused there (404): Prometheus scrapes them inside
the network.

Backup uses the existing `transcendence` network but a separate Compose lifecycle
and writes to a host folder, outside every volume. Dumps run hourly and retention
is 24 hours; a restore stops the application and is all or nothing. The API
reads the time of the last success (read-only mount) for the status page and the
alerts.

Development replaces Nginx with Angular's dev server/proxy on 4200, exposes
NestJS on APIPORT and Grafana on 3001, and uses source bind mounts. This diagram
shows production; it does not imply development TLS or an extra API instance.

Evidence: [main Compose](../srcs/docker-compose.yml),
[backup Compose](../backup/docker-compose.yml),
[Nginx](../srcs/angular/conf/nginx.conf),
[Prometheus](../srcs/prometheus/prometheus.yml),
[Alertmanager](../srcs/alertmanager/alertmanager.yml),
[recovery guide](../BACKUP.md).
