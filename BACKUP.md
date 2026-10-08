# PostgreSQL Backup & Disaster Recovery

## Overview

The project includes an independent PostgreSQL backup service.

The backup service runs continuously alongside the main application and automatically creates a database backup **every hour**.

Backups are retained for **24 hours**. Once a backup is older than 24 hours, it is automatically deleted.

This means the backup system provides protection against database loss, but it is **not a zero-data-loss system**.

---

## Backup Schedule

Backups are created **once every hour**.

Each backup is stored using the following naming format:

```text
transcendence_YYYY-MM-DD_HH-MM-SS.sql.gz
```

For example:

```text
transcendence_2026-10-08_15-00-00.sql.gz
transcendence_2026-10-08_16-00-00.sql.gz
transcendence_2026-10-08_17-00-00.sql.gz
```

The backup is a compressed SQL dump produced with `pg_dump` and compressed using `gzip`.

### Retention

Backups older than **24 hours** are automatically removed.

The backup service therefore maintains approximately the last 24 hours of hourly backups.

For example, if the current time is:

```text
2026-10-08 17:30
```

a backup from:

```text
2026-10-07 16:00
```

is older than 24 hours and will be removed.

---

## Backup Storage

The backups are stored in a dedicated persistent volume:

```yaml
volumes:
  backup_data:
    name: transcendence_backup_data
```

The volume is mounted inside the backup container at:

```text
/backups
```

through:

```yaml
volumes:
  - backup_data:/backups
```

The PostgreSQL database itself uses a **different volume** (would be a shame that a disk corruption on one machine would imply not having data):

```yaml
volumes:
  - postgres_data:/var/lib/postgresql/data
```

This separation is important.

```text
PostgreSQL
    │
    └── postgres_data
            │
            └── /var/lib/postgresql/data


Backup service
    │
    └── transcendence_backup_data
            │
            └── /backups
```

Destroying the PostgreSQL data volume does not automatically destroy the backup volume.

Likewise, destroying the backup volume would not destroy the live PostgreSQL database.

---

# Restoring a Backup

## Important warning

**Restoring a backup means going back to the state of the database contained in that backup.**

Any data created or modified after the selected backup was made may be lost.

The backup system runs once per hour, so the maximum normal amount of database data that can be lost because of a crash is approximately **one hour**.

For example:

```text
15:00  ──────── Backup created
15:01
15:30  ──────── User creates data
15:45  ──────── More data created
15:59  ──────── More data created
16:00  ──────── Next backup would normally occur
16:01  ──────── Database crashes
```

If the database crashes at `16:01` before the `16:00` backup has successfully completed, the most recent available backup could be the one from `15:00`.

Restoring it would recover the database as it existed around `15:00`.

Therefore, potentially:

```text
15:00 backup
     ↓
15:01 → 16:01
       ↑
       up to ~59 minutes of changes
       may be lost
```

This is the fundamental trade-off of an hourly backup system.

**The backup system protects against catastrophic database loss, but it does not guarantee zero data loss.**

---

# Easy Mode — Makefile

The recommended recovery procedure for normal users is to use the Makefile.

## 1. Stop the application

PostgreSQL must remain running while the backup is restored, but the application should not be writing to the database.

Run:

```bash
make stop-app
```

This stops:

* `chess-engine`
* `nginx`
* `prometheus`
* `nestjs`
* `grafana`

PostgreSQL remains running.

---

## 2. Find the backup you want to restore

List the available backups inside the backup container:

```bash
docker exec transcendence-backup ls -lh /backups
```

Example:

```text
transcendence_2026-10-08_13-00-00.sql.gz
transcendence_2026-10-08_14-00-00.sql.gz
transcendence_2026-10-08_15-00-00.sql.gz
transcendence_2026-10-08_16-00-00.sql.gz
```

Choose the backup you want to restore.

Normally, you should choose the **most recent valid backup** unless you specifically need to recover an earlier state.

---

## 3. Restore the backup

Run the restore script inside the backup container:

```bash
docker exec -it transcendence-backup \
    /usr/local/bin/restore.sh transcendence_<date>.sql.gz
```

The restore script will ask for confirmation before restoring the database.

Confirm the operation when prompted.

---

## 4. Start the application again

Once the restore has completed successfully:

```bash
make start-app
```

The application services will start again while PostgreSQL remains available.

---

## Complete Easy Mode Procedure

In practice:

```bash
make stop-app
```

```bash
docker exec transcendence-backup ls -lh /backups
```

Choose the desired backup and restore it:

```bash
docker exec -it transcendence-backup \
    /usr/local/bin/restore.sh <backup-file>
```

Then:

```bash
make start-app
```

The database is now restored to the state contained in the selected backup.

---

# Developers / Power Users

The backup container can also be controlled directly through the Docker CLI.

This is useful for debugging, inspecting backups, or performing a recovery without using the Makefile when this one failed, and hence needs trouble shooting.

## List available backups

```bash
docker exec transcendence-backup \
    ls -lh /backups
```

If no backup are available it means the backup container wasn't online long enough of that it got wiped
---

## Inspect the backup container

```bash
docker exec -it transcendence-backup bash
```

From inside the container:

```bash
ls -lh /backups
```

Exit with:

```bash
exit
```

---

## Stop application containers manually

The equivalent of `make stop-app` is:

```bash
docker compose -f srcs/docker-compose.yml \
    stop chess-engine nginx prometheus nestjs grafana
```

PostgreSQL is deliberately **not** included, the objective here is to prevent data corruption by removing any chance an exterior component tries to access the DB while we are editing it.

---

## Restore a backup manually

After stopping the application:

```bash
docker exec -it transcendence-backup \
    /usr/local/bin/restore.sh <backup-file>
```

For example:

```bash
docker exec -it transcendence-backup \
    /usr/local/bin/restore.sh transcendence_2026-10-08_16-00-00.sql.gz
```

---

## Start the application manually

```bash
docker compose -f srcs/docker-compose.yml \
    start chess-engine nginx prometheus nestjs grafana
```

---

# Recovery Architecture

The backup service is intentionally independent from the main application stack.

```text
                         transcendence network
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
      PostgreSQL             NestJS             Backup container
          │                     │                     │
          │                     │                     ├── cron
          │                     │                     │    └── backup.sh
          │                     │                     │
          │                     │                     ├── restore.sh
          │                     │					  |
          ▼                     │                     ▼
    postgres_data               │        transcendence_backup_data
                                │                     │
                                │                     └── /backups
                                │
                                └── application
```

The backup container remains running continuously.

Cron executes `backup.sh` every hour.

`restore.sh` is **not** executed automatically. It is only executed manually when a database recovery is required.

---

# Important Operational Rules

### Do not stop the backup container during normal operation

The backup container must remain running for its hourly cron job to execute.

### Do not delete `transcendence_backup_data` unless you intentionally want to delete the backup history

The backup volume contains the recovery points for the database.

### Be careful with `make clean`

The PostgreSQL data and backup data are separate volumes.

Deleting:

```text
postgres_data
```

destroys the current PostgreSQL data.

Deleting:

```text
transcendence_backup_data
```

destroys the stored backup history.

Both are important, but they serve completely different purposes.

### A backup is not a replacement for redundancy

The backup system protects against database corruption or loss of the live PostgreSQL data, but it does not protect against every possible failure.

For example, if both:

```text
postgres_data
```

and:

```text
transcendence_backup_data
```

are destroyed, there is no local backup left to restore.

For a real production system, backups should eventually be copied to storage independent from the machine running the application.

---

# Recovery Time and Data Loss

This system uses an **hourly backup interval**.

Therefore:

| Situation                                       | Expected result                                      |
| ----------------------------------------------- | ---------------------------------------------------- |
| Database crashes immediately after a backup     | Up to ~1 hour of recent changes may be lost          |
| Database crashes shortly before the next backup | Recent changes since the previous backup may be lost |
| Database data is completely destroyed           | Restore the latest available backup                  |
| Backup volume is also destroyed                 | Local recovery is impossible                         |
| Backup is more than 24 hours old                | It is automatically removed                          |

The important concept is **RPO (Recovery Point Objective)**.

The current backup strategy has an approximate:

```text
RPO ≈ 1 hour
```

This means the system is designed to tolerate the potential loss of roughly one hour of database changes in the event of a failure.

The backup frequency can be increased in the future if a lower RPO is required.
