#!/bin/bash
set -euo pipefail
umask 077

# Written at container start by entrypoint.sh (cron passes no environment).
if [ -f /etc/transcendence-backup.env ]; then
    . /etc/transcendence-backup.env
fi

DATE=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP="/backups/transcendence_${DATE}.sql.gz"

echo "Starting PostgreSQL backup... Please do not down this container during this action"

TEMP=$(mktemp "${BACKUP}.XXXXXX.partial")

# Removes the incomplete file when the script fails.
trap 'rm -f -- "$TEMP"' EXIT

# Plain SQL without owners or grants: restore.sh replays it as the database
# owner into an emptied schema.
pg_dump --no-password --no-owner --no-privileges | gzip > "$TEMP"
gzip -t "$TEMP"

# The file becomes an available backup only once it is complete.
mv -- "$TEMP" "$BACKUP"

# Read by the status page and the monitoring alert on stale backups.
date -u +"%Y-%m-%dT%H:%M:%SZ" > /backups/last-success

echo "Backup created: $BACKUP"

## Remove backups from more than 24hours ago

echo "Removing old backups..."

find /backups -type f -name "transcendence_*.sql.gz" -mmin +1440 -delete

echo "Old backups cleaned."
