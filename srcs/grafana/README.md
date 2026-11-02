# Grafana dashboards

The existing `Transcendence` file provider provisions both `transcendence.json`
and `websocket.json` into the Transcendence folder. The image copies the
provisioning directory; rebuild and recreate Grafana after changing dashboards:

```sh
docker compose -f srcs/docker-compose.dev.yml up -d --build grafana
```

Open **Transcendence - WebSocket** in Grafana, or its stable dashboard path
`/d/transcendence-websocket` under the configured Grafana base URL. Production
uses the `/grafana/` prefix. The dashboard uses the existing Prometheus datasource
UID `prometheus` and scrape job `nestjs`; no additional provider is required.

## Reading WebSocket metrics

- **Active sockets** and its history show accepted `/ws` connections currently
  open, including sockets awaiting authentication. They are connection counts,
  not authenticated-user counts.
- **Opened total** counts accepted connections; **Closed total** counts their
  closures, including authentication failures. Rejected HTTP upgrades do not
  enter these counters. Totals are summed across currently scraped processes,
  reset when processes restart, and do not represent the selected time window.
- **Connection open / close rates** show connections per second. PromQL applies
  `rate` to each counter before summing, so independent process resets do not
  create a false spike. `$__rate_interval` adapts the lookback to the configured
  scrape interval and visible time range. A rate needs at least two samples.
- **NestJS scrape health** shows DOWN if any discovered NestJS target has
  `up = 0`, UP if all are reachable, and No data when target series are absent.
  This measures scraping, not application readiness.

Missing metrics display **No data**, with gaps in the histories; missing samples
are never replaced with zero. Prometheus can retain a recent sample briefly
following a failed scrape, so check scrape health when reading connection counts.
A scraped zero and an absent time series have different meanings. The metrics
have no application labels for user, room, or game; Prometheus adds target labels
such as `job` and `instance`.

## Validate

Run the offline contract check from the repository root (Python 3, no packages):

```sh
python3 srcs/grafana/scripts/validate_dashboards.py
```

It checks dashboard JSON structure, schema version fields, unique dashboard and
panel IDs, panel grid positions, target references, datasource UID provisioning,
image/provider paths, and the WebSocket metric names against gateway
registrations. WebSocket expressions are restricted to the expected valid PromQL
forms: aggregate values, per-target counter rates, and target health. This is a
focused contract check, not a complete Grafana JSON-schema or PromQL parser.

For a running stack, verify these behaviors in Grafana:

1. With NestJS being scraped, idle metrics read zero and scrape health reads UP.
2. Connect a same-origin `/ws` client: active and opened increase. Disconnect:
   active decreases and closed increases. Observe both rate series after at least
   two scrapes. An unauthenticated socket can close quickly due to the auth timeout.
3. Restart NestJS: lifetime totals reset; the rate graphs handle counter resets.
4. Stop NestJS: scrape health reads DOWN. Once Prometheus marks the metric series
   stale, connection panels show No data and histories have gaps.

Runtime smoke checks require Grafana, Prometheus, and NestJS running together;
the offline check does not validate rendering or connectivity.

## Matchmaking and durable inventories (Sprint 4)

Open `/d/transcendence-matchmaking` (with `/grafana/` prefix in production).
Metrics use the existing Prometheus registry and the provisioned `nestjs` scrape job.

| Metric | Meaning |
| --- | --- |
| `games_finished` | Retained FINISHED game rows |
| `matchmaking_queue_size` | Currently WAITING queue entries |
| `puzzle_attempts{outcome="solved|unsolved"}` | Retained training sessions grouped by current solved state, including legacy rows; not submitted moves or retries |
| `puzzle_move_submissions` | Sum of recorded move submissions (correct and incorrect) across retained sessions; legacy NULL measurements excluded |
| `matchmaking_wait_seconds_bucket{le="..."}` | Cumulative count of retained committed player waits at fixed second boundaries |
| `matchmaking_wait_seconds_count` | Two player observations per retained committed match |
| `matchmaking_wait_seconds_sum` | Total seconds waited by those retained players |

All of these are **gauges of database inventory**, including the bucket/count/sum
families. No scrape increments a counter or replays events. Purging a game cascades
its match journal observations; removing puzzle sessions decreases their inventory.
Requeue does not erase previous match observations because the journal is independent
of the reusable queue rows. Rollbacks contribute no committed observations.

The dashboard uses `max` across replicas sharing one PostgreSQL database; never sum
those duplicate inventories. For independent database shards, add an infrastructure
shard label before aggregation. Current replicas may read successive committed states
near a transaction boundary. Wait buckets/count/sum share one SQL snapshot within a
scrape. `histogram_quantile` estimates the retained distribution directly without
`rate`; this is not a time-window event throughput metric. An empty distribution has
no mean/quantile. Units are seconds, bucket labels are fixed, puzzle outcome has exactly
two allowed values, and there are no user/game/token labels.

Collectors scan retained inventories at scrape time (SQL aggregate, no row payloads
loaded into Node). Plan retention and scrape frequency for large tables. Database
errors fail the scrape; they do not fabricate zero. Provider rebuilds rebind collectors
without retaining closed connections. Restart does not alter durable inventories.
