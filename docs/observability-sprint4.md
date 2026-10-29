# Sprint 4 observability audit

Base: `12448f04e177d72d92097e670738cb73007e9841`, preserving published Sprint 4
foundation and integrated sessions/presence. Scope: SCRUM-425, 426, 427, 428, 429,
430, 431, 438, 440. No Jira status is changed by these commits.

Already present and preserved: HTTP latency histogram with bounded route labels,
accepted WebSocket connection lifecycle metrics, shared-database active-game gauge,
provisioned WebSocket dashboard and validation. New work fills finished-game,
matchmaking queue/wait and puzzle attempt inventory visibility plus matchmaking dashboard.

Ownership: `src/metrics/durable-metrics*`, `src/metrics/match-wait-metrics*`,
`src/games/games-metrics.service.ts`, new observability integration tests,
`srcs/grafana/**` and this document. No changes to puzzle services, matchmaking
producers, clock/realtime, presence, application root module or private environment.

Wait observations depend explicitly on the matchmaking worker migration
`1793208000000-AddMatchmakingGame` and committed `matchmaking_matches` journal:
`gameId` primary key cascading on game deletion, `matchedAt`, `whiteWaitSeconds`,
`blackWaitSeconds`. Durations are produced once inside the actual matching transaction;
Dependency explicitly merged append-only: `7fc2f14a1114470c6fb0a3e37ca3f2941ee6350b`.
Metrics never reconstruct event waits from queue rows reused on rejoin.

All new instruments are retained database **gauge inventories**, not monotone event
counters. This distinction makes purge, rollback, rebuild and multi-instance behavior
honest. Cardinality: no labels except two puzzle outcomes and ten fixed wait boundaries.
Each match contributes two player waits. See Grafana README for exact aggregation,
units, retention, performance and replica interpretation.

Validation commands (backend in existing Node22 Docker image with readonly deps and
Vite tmpfs caches):

- `npm run build && npm run test:contracts`
- `npx vitest run src/metrics`
- `npx vitest run --config vitest.config.database.ts test/games-metrics.integration-spec.ts test/durable-metrics.integration-spec.ts`
- `python srcs/grafana/scripts/validate_dashboards.py`
- `git diff --check`

The dashboard validator checks provisioned datasource, grid/IDs, exact inventory
PromQL contract and units; it is not a live Grafana browser or a complete PromQL parser.

## Final validation (2026-10-29)

- Backend build and TypeScript contracts: PASS.
- Metrics unit/HTTP integration: 6 files, 19 tests passed.
- Real PostgreSQL metrics: 2 files, 6 tests passed (retained states, repeated scrapes,
  rollback visibility, deletion cascade/purge, collector rebuild and independent replicas).
- Full backend lint: exit 0, 28 existing warnings, 0 errors; no producer/realtime edits.
- Offline Grafana validation: 3 dashboards passed, including inventory PromQL and units.
- `git diff --check`: PASS. No private environment or secret files changed.

These checks use the released Node22 test image, read-only dependency volume and isolated
Vite caches, with dedicated test PostgreSQL port 55436. No live Grafana/Prometheus stack
rendering check was performed. SQL aggregations scan retained rows; retention/scrape
frequency must be sized for the deployed data volume. Wait metrics require the explicit
matchmaking dependency above to be deployed before scraping.
