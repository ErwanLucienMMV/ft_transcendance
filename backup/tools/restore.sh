#!/bin/bash
# Restores one backup over the current database, in a single transaction:
# either the whole backup is restored, or nothing changes.
set -euo pipefail

# Owner connection settings, written by entrypoint.sh.
if [ -f /etc/transcendence-restore.env ]; then
    . /etc/transcendence-restore.env
fi

if [ "${1:-}" = "" ]; then
    echo "Usage: restore.sh <backup_file> [--yes]"
    echo "Available backups:"
    ls -1t /backups 2>/dev/null | grep '^transcendence_.*\.sql\.gz$' || echo "  (none)"
    exit 1
fi

BACKUP="/backups/$(basename -- "$1")"

if [ ! -f "$BACKUP" ]; then
    echo "Backup not found: $BACKUP"
    exit 1
fi

gzip -t "$BACKUP"

echo "WARNING: This will replace the database with the content of:"
echo "$BACKUP"
echo

if [ "${2:-}" != "--yes" ]; then
    read -r -p "Continue? [y/N] " CONFIRM
    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        echo "Restore cancelled."
        exit 0
    fi
fi

echo "Restoring PostgreSQL..."

# The public schema is emptied first, so the dump (with or without DROP
# statements) recreates every table. ON_ERROR_STOP and --single-transaction
# roll everything back on the first error instead of reporting a success.
{
    echo 'DROP SCHEMA IF EXISTS public CASCADE;'
    echo 'CREATE SCHEMA public;'
    gunzip -c "$BACKUP"
} | PGOPTIONS="-c client_min_messages=warning" psql \
    --no-psqlrc \
    --quiet \
    --set ON_ERROR_STOP=1 \
    --single-transaction \
    --host="$PGHOST" \
    --port="$PGPORT" \
    --username="$PGUSER" \
    --dbname="$PGDATABASE" > /dev/null

echo "PostgreSQL restoration completed successfully."
