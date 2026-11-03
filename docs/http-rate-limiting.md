# HTTP request limits — SCRUM-491 / SEC-10

Production HTTP traffic enters through Nginx. Its shared memory zones apply
the same per-client budget across workers, before requests reach NestJS:

| Scope | Sustained rate | Additional burst |
| --- | --- | --- |
| `/api/` | 10 requests/second | 40 requests |
| `/api/v1/avatars/` (uploaded pictures) | 50 requests/second | 100 requests |
| Login, registration, 2FA code, verification, password reset and OAuth start/callback/link/exchange (Google, GitHub, 42) | 10 requests/minute | 10 requests |

The authentication budget is shared across those endpoints. Query strings,
case variants and normalized paths do not create separate budgets. The key
is the TCP peer address, so supplying `X-Forwarded-For` or `X-Real-IP` cannot
reset it. Users behind the same NAT share a budget. If another proxy is added
in front of Nginx, configure its trusted addresses explicitly before adopting
forwarded client addresses.

Exhausted budgets return HTTP 429 with the API's `TOO_MANY_REQUESTS` JSON
shape, `Retry-After: 6`, `Cache-Control: no-store` and the usual security
headers. Requests are rejected without being queued. Ordinary API requests,
session refresh and logout do not consume the stricter authentication budget.
The existing WebSocket message and payload limits are independent.

## Behind Nginx

- Nginx sends the API `X-Forwarded-For` set to the TCP peer, replacing any
  value the client sent. The API trusts private proxy addresses only
  (`trust proxy` in `main.ts`), so the address its own limits count is the
  one Nginx saw.
- The API keeps its own limits (`src/common/rate-limit.ts`): 600 requests a
  minute on every route, 20 a minute on the sign-in steps and the routes that
  check a password or a code, 5 per 10 minutes on the routes that email an
  existing account, and 20 registrations per 10 minutes (a room behind one
  address, such as an evaluation, can still open several accounts). They also protect the API when it is reached without Nginx (the
  development proxy). `RATE_LIMIT_ENABLED=false` turns them off for test
  stacks that create many accounts from one address.
- `/api/metrics` and `/api/v1/metrics`, in any case, answer 404: Prometheus
  scrapes the API inside the Docker network.

These limits apply to the production Nginx entry point. The Angular development
proxy and direct NestJS access do not use Nginx and therefore do not apply them.
No new service, dependency or application state is required.

## Test

Validation uses the production configuration with only ports, certificate
paths, log paths, the security headers include and fixture upstream addresses
substituted. Two Nginx workers and a local HTTP upstream exercise shared
authentication quotas, general bursts, independent clients, forwarding-header
spoofing, URI normalization, JSON errors, proxy path forwarding, recovery
after the retry interval, the separate picture budget, the hidden metrics and
the forwarded address.

With `nginx`, `openssl`, and Python 3 available:

```sh
python3 srcs/angular/tests/nginx-rate-limit.test.py
```

The CI runs it on every push.
