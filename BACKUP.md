# PostgreSQL Backup & Disaster Recovery

## Overview

The project includes an independent PostgreSQL backup service
(`backup/docker-compose.yml`). It runs alongside the main application and
creates a database backup **every hour**. Backups are kept for **24 hours**;
older ones are deleted automatically.

The backup system protects against the loss of the database, but it is **not a
zero-data-loss system**: up to one hour of changes can be lost (see
[Recovery Time and Data Loss](#recovery-time-and-data-loss)).

| Command | What it does |
| --- | --- |
| `make full` | Starts the application, then the backup service |
| `make backup` / `make backup-down` | Starts or stops the backup service alone |
| `make backup-now` | Takes a backup immediately |
| `make backups` | Lists the backups, newest first |
| `make restore BACKUP=<file>` | Restores one backup (asks for confirmation, `YES=1` skips it) |
| `make backup-logs` | Follows the backup service logs |

---

## Backup Schedule

Backups are created **once every hour** by cron, under this name:

```text
transcendence_YYYY-MM-DD_HH-MM-SS.sql.gz
```

Each backup is a plain SQL dump produced with `pg_dump`
(`--no-owner --no-privileges`) and compressed with `gzip`. It is written to a
temporary file, checked with `gzip -t`, and only then renamed: an interrupted
backup never leaves a truncated file behind.

After each successful backup, the service writes the time of the backup to
`backups/status/last-success`. The API mounts only that folder, read-only, and
reports the age of the last backup on the status page (`/status`), in
`/api/v1/health` and to Prometheus: the `BackupStale` alert fires when it is
older than two hours, `BackupMissing` when none was ever recorded (see
[DOC_MONITORING.md](DOC_MONITORING.md)). The dumps themselves stay readable by
root only.

Backups older than **24 hours** are removed, so the service keeps about the
last 24 hourly backups.

---

## Backup Storage

The backups are stored in the **`backups/` folder at the root of the
repository**, on the host, mounted inside the backup container at `/backups`:

```yaml
volumes:
  - ${BACKUP_DIR:-../backups}:/backups
```

This folder is outside every Docker volume:

- `make clean`, `make re` and even `make fclean` (which deletes the database
  volume) never delete it;
- it can be copied to another machine with ordinary tools (`rsync`, `scp`).
  Doing so regularly is what protects against the loss of the whole machine.

Set `BACKUP_DIR` in the environment to store the backups somewhere else (for
example a mounted disk). The folder is ignored by git.

```text
PostgreSQL ── postgres_data (Docker volume) ── /var/lib/postgresql/data

Backup service ── backups/ (host folder) ── /backups
```

---

## Database Access

The backup container reads its settings from `srcs/.env` when it starts. It
stops immediately with a clear message when one of these is missing:

- `POSTGRES_BACKUP_USER`, `POSTGRES_BACKUP_PASSWORD`: the **read-only role**
  used by the hourly backups (`pg_read_all_data`) and by postgres-exporter for
  the monitoring (`pg_monitor`);
- `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`: the **owner of the
  database**, used only by a restore, which has to rewrite every table.

Because cron gives its jobs an empty environment, `tools/entrypoint.sh` writes
these settings to two root-only files that `backup.sh` and `restore.sh` load.

The `postgres` container creates the read-only role, or updates its password
and grants, **each time it starts**, from the same two variables. A database
created by an older version of the project therefore needs nothing by hand:
restart it (`make` does) and backups and metrics work.

Check a backup by hand:

```bash
make backup-now
```

---

# Restoring a Backup

## Important warning

**Restoring a backup means going back to the state of the database contained
in that backup.** Any data created or modified after that backup is lost.

## How a restore works

`restore.sh` runs **in a single transaction**:

1. it empties the `public` schema;
2. it replays the backup;
3. it commits only if every statement succeeded.

The first error (a damaged file, a missing permission) rolls everything back
and the script stops with an error: the database is then exactly as it was
before the restore. It never reports a success after a partial restore.

## Easy mode: the Makefile

```bash
make backups                                         # pick a file
make restore BACKUP=transcendence_2026-11-02_16-00-00.sql.gz
```

`make restore` stops the application (PostgreSQL keeps running, so nothing
writes during the restore), asks for confirmation, restores the backup, then
starts the application again, whatever the result. From a script, without a
terminal, add `YES=1` to skip the question.

## Manual mode

The same steps without the Makefile, for troubleshooting:

```bash
# 1. Stop everything that writes to the database (PostgreSQL stays up)
docker compose -f srcs/docker-compose.yml stop chess-engine bot forgemail \
    nestjs nginx prometheus alertmanager grafana node-exporter cadvisor postgres-exporter

# 2. List the backups
ls -lt backups/

# 3. Restore one (add --yes to skip the question)
docker exec -it transcendence-backup \
    /usr/local/bin/restore.sh transcendence_2026-11-02_16-00-00.sql.gz

# 4. Start the application again
docker compose -f srcs/docker-compose.yml start chess-engine bot forgemail \
    nestjs nginx prometheus alertmanager grafana node-exporter cadvisor postgres-exporter
```

## Full disaster: the database volume is gone

When the PostgreSQL volume itself is lost (disk failure, `make fclean`):

```bash
make            # recreates an empty database and runs the migrations
make backup     # starts the backup service (the backups/ folder is intact)
make restore BACKUP=<latest file from make backups>
```

The restore replaces the empty tables created by the migrations with the
content of the backup.

The step-by-step procedure for each kind of disaster, and the record of its
test on a wiped database, are in
[docs/reprise-apres-sinistre.md](docs/reprise-apres-sinistre.md).

---

# Recovery Architecture

```text
                         transcendence network
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
      PostgreSQL             NestJS             Backup container
          │                     │                     ├── cron ── backup.sh (hourly)
          │                     │                     └── restore.sh (manual)
          ▼                     │                     ▼
    postgres_data               │               backups/ (host folder)
    (Docker volume)             └── application
```

`restore.sh` is **never** executed automatically.

---

# Important Operational Rules

- **Keep the backup container running**: its cron job only runs while it is up.
- **`make clean` and `make re` keep every piece of data.** `make fclean`
  deletes the database volume (after a confirmation) but keeps `backups/`.
- **Copy `backups/` off the machine regularly.** If the machine and its disk
  are lost together, only an off-site copy can bring the data back.

---

# Recovery Time and Data Loss

| Situation | Expected result |
| --- | --- |
| Database crashes immediately after a backup | Almost nothing is lost |
| Database crashes shortly before the next backup | Up to ~1 hour of changes is lost |
| Database volume is destroyed | Restore the latest backup |
| `backups/` is also destroyed | Only an off-site copy can help |
| Backup is more than 24 hours old | It is removed automatically |

The current strategy has an approximate **RPO (Recovery Point Objective) of
one hour**: the system tolerates the loss of about one hour of changes. The
backup frequency (`backup/tools/crontab`) can be increased for a lower RPO.
