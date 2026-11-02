#!/bin/bash

set -e

# Same connection settings as the backups (written by entrypoint.sh).
if [ -f /etc/transcendence-backup.env ]; then
    . /etc/transcendence-backup.env
fi

if [ -z "$1" ]; then
    echo "Usage: rollback.sh <backup_file>"
    exit 1
fi

BACKUP="/backups/$1"

if [ ! -f "$BACKUP" ]; then
    echo "Backup not found: $BACKUP"
    exit 1
fi

echo "WARNING: This will restore the database from:"
echo "$BACKUP"
echo
read -r -p "Continue? [y/N] " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Restore cancelled."
    exit 0
fi

echo "Restoring PostgreSQL..."

gunzip -c "$BACKUP" | psql \
    --host="$PGHOST" \
    --port="$PGPORT" \
    --username="$PGUSER" \
    --dbname="$PGDATABASE"

echo "PostgreSQL restoration completed successfully."