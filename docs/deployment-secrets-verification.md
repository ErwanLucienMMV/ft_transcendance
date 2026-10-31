# Docker secret handling — SCRUM-494 / SEC-13

Review date: 31 October 2026. Base: `origin/dev_test` at `b49b735`.

Two gaps were confirmed in the repository configuration:

- The broad root and application build contexts did not consistently exclude
  nested `.env` files and `.env.*` variants. For example, NestJS excluded
  `42chess/.env` but could copy `42chess/.env.production` into the image.
- `init-env.sh` inherited its caller's umask. Under a normal `022` umask, newly
  generated `.env` and temporary replacement files were readable by other users.

The four broad build contexts now exclude `**/.env` and `**/.env.*`.
The initialization script sets `umask 077` before creating files. Existing
configured values are preserved; this change does not rotate credentials or
change an already complete environment file's permissions. Existing installations
should inspect their file permissions separately. No actual environment file was
read, rewritten or printed during this work.

Tracked environment inputs are `.env.example` (empty credentials) and `.env.ci`
(explicit test-only values). Runtime credentials are injected by Compose; no
Dockerfile `ARG` or `ENV` was added for secrets. PostgreSQL, Grafana, Prometheus
and backup Dockerfiles copy explicitly named scripts/configuration paths. The
bot and backend test images use the broad root context and its ignore policy.

## Validation

`python3 srcs/tests/deployment-secrets.test.py` passed all six scenarios:

- New secrets are distinct 256-bit random values, absent from script output,
  and stored in a new file with mode `0600` even when the caller uses `022`.
- A second run preserves the entire file byte for byte.
- Existing credentials and the last line of a partial file are retained.
- Empty values are filled via a private replacement file, without residual
  temporary files.
- The real container builder applies each of the four production ignore files
  to a synthetic fixture. All top-level/nested `.env` variants are absent after
  `COPY .`, while ordinary source files remain present.
- Generated environment paths are absent from tracked files.

The test requires Python 3, Git, a Docker-compatible builder, and the Debian
bookworm base image. It only runs the initialization script in fresh temporary
directories and only builds synthetic fixture images. It does not touch a
production environment, database or persistent volume.

`sh -n srcs/init-env.sh` and `git diff --check` also passed.
No production credential rotation or deployment was performed. Credentials in
existing images, remote secret stores and historical commits were outside this
configuration check; these results do not assert their absence.
