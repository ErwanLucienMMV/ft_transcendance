#!/bin/bash
# cron starts jobs with an empty environment, so the PostgreSQL settings the
# container receives are written to a root-only file that the scripts source.
set -euo pipefail

: "${POSTGRES_BACKUP_USER:?POSTGRES_BACKUP_USER is missing from srcs/.env}"
: "${POSTGRES_BACKUP_PASSWORD:?POSTGRES_BACKUP_PASSWORD is missing from srcs/.env}"
: "${DATABASE_NAME:?DATABASE_NAME is missing from srcs/.env}"

ENV_FILE=/etc/transcendence-backup.env
umask 077
{
    printf 'export PGHOST=%q\n' "${PGHOST:-postgres}"
    printf 'export PGPORT=%q\n' "${PGPORT:-5432}"
    printf 'export PGUSER=%q\n' "$POSTGRES_BACKUP_USER"
    printf 'export PGPASSWORD=%q\n' "$POSTGRES_BACKUP_PASSWORD"
    printf 'export PGDATABASE=%q\n' "$DATABASE_NAME"
} > "$ENV_FILE"

exec cron -f
