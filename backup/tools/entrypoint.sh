#!/bin/bash
# cron starts jobs with an empty environment, so the PostgreSQL settings the
# container receives are written to root-only files that the scripts source.
set -euo pipefail

: "${POSTGRES_BACKUP_USER:?POSTGRES_BACKUP_USER is missing from srcs/.env}"
: "${POSTGRES_BACKUP_PASSWORD:?POSTGRES_BACKUP_PASSWORD is missing from srcs/.env}"
: "${DATABASE_NAME:?DATABASE_NAME is missing from srcs/.env}"
: "${DATABASE_USER:?DATABASE_USER is missing from srcs/.env}"
: "${DATABASE_PASSWORD:?DATABASE_PASSWORD is missing from srcs/.env}"

umask 077

# Backups use the read-only role.
{
    printf 'export PGHOST=%q\n' "${PGHOST:-postgres}"
    printf 'export PGPORT=%q\n' "${PGPORT:-5432}"
    printf 'export PGUSER=%q\n' "$POSTGRES_BACKUP_USER"
    printf 'export PGPASSWORD=%q\n' "$POSTGRES_BACKUP_PASSWORD"
    printf 'export PGDATABASE=%q\n' "$DATABASE_NAME"
} > /etc/transcendence-backup.env

# A restore rewrites every table, so it connects as the owner of the database.
{
    printf 'export PGHOST=%q\n' "${PGHOST:-postgres}"
    printf 'export PGPORT=%q\n' "${PGPORT:-5432}"
    printf 'export PGUSER=%q\n' "$DATABASE_USER"
    printf 'export PGPASSWORD=%q\n' "$DATABASE_PASSWORD"
    printf 'export PGDATABASE=%q\n' "$DATABASE_NAME"
} > /etc/transcendence-restore.env

mkdir -p /backups

exec cron -f
