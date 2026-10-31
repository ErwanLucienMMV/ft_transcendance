# HTTP request limits — SCRUM-491 / SEC-10

Production HTTP traffic enters through Nginx. Its shared memory zones apply
the same per-client budget across workers, before requests reach NestJS:

| Scope | Sustained rate | Additional burst |
| --- | --- | --- |
| `/api/` | 10 requests/second | 40 requests |
| Login, registration, verification and OAuth start/callback/link/exchange | 10 requests/minute | 10 requests |

The authentication budget is shared across those endpoints. Query strings,
case variants and normalized paths do not create separate budgets. The key
is the TCP peer address, so supplying `X-Forwarded-For` or `X-Real-IP` cannot
reset it. Users behind the same NAT share a budget. If another proxy is added
in front of Nginx, configure its trusted addresses explicitly before adopting
forwarded client addresses.

Exhausted budgets return HTTP 429 with the existing `TOO_MANY_REQUESTS` JSON
shape, `Retry-After: 6`, and `Cache-Control: no-store`. Requests are rejected
without being queued. Ordinary API requests, session refresh and logout do not
consume the stricter authentication budget. The existing WebSocket message
and payload limits are independent.

These limits apply to the production Nginx entry point. The Angular development
proxy and direct NestJS access do not use Nginx and therefore do not apply them.
No new service, dependency or application state is required.

Validation uses the production configuration with only ports, certificate paths,
log paths and fixture upstream addresses substituted. Two Nginx workers and a
local HTTP upstream exercise shared authentication quotas, general bursts,
independent clients, forwarding-header spoofing, URI normalization, JSON errors,
proxy path forwarding and recovery after the retry interval.

With `nginx`, `openssl`, and Python 3 available:

```sh
python3 srcs/angular/tests/nginx-rate-limit.test.py
```

Validated on 31 October 2026 with Debian bookworm's Nginx: configuration syntax
and all three integration scenarios passed. No production services were started
or reconfigured during validation.
