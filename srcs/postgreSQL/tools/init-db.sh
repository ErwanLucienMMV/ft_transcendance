#!/bin/bash

set -euo pipefail

PGDATA="/var/lib/postgresql/data"
PG_BIN="/usr/lib/postgresql/15/bin"

# Runs a command as the postgres user without a shell, so values keep their quotes.
as_postgres() {
    HOME=/var/lib/postgresql setpriv --reuid=postgres --regid=postgres --init-groups "$@"
}

mkdir -p /var/run/postgresql
chown postgres:postgres /var/run/postgresql
chmod 775 /var/run/postgresql

mkdir -p "$PGDATA"
chown -R postgres:postgres "$PGDATA"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "Initializing PostgreSQL..."

    # Migrations and message content require Unicode, even on a minimal image
    # whose default locale would otherwise create a SQL_ASCII cluster.
    as_postgres "$PG_BIN/initdb" -D "$PGDATA" --encoding=UTF8 --locale=C.UTF-8

    # The server listens inside its container only; no port is published, and
    # password logins are limited to the subnets the container is attached to
    # (the Docker network of the stack).
    sed -i "s/^#listen_addresses = 'localhost'/listen_addresses = '*'/" \
        "$PGDATA/postgresql.conf"
    echo "host all all samenet scram-sha-256" >> "$PGDATA/pg_hba.conf"

    echo "Starting PostgreSQL temporarily..."

    as_postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -o "-c listen_addresses=localhost" -w start
    started=1

    # Values are passed as psql variables (:"name" for identifiers, :'name'
    # for literals) so they are quoted by psql, never pasted into the SQL.
    as_postgres psql -v ON_ERROR_STOP=1 \
        -v app_user="$POSTGRES_USER" \
        -v app_password="$POSTGRES_PASSWORD" \
        -v app_db="$POSTGRES_DB" <<-'EOSQL'
		CREATE USER :"app_user" WITH PASSWORD :'app_password';
		CREATE DATABASE :"app_db" OWNER :"app_user";
	EOSQL
elif [ -n "${POSTGRES_BACKUP_USER:-}" ] && [ -n "${POSTGRES_BACKUP_PASSWORD:-}" ]; then
    echo "Starting PostgreSQL temporarily to check the read-only role..."
    as_postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -o "-c listen_addresses=localhost" -w start
    started=1
fi

# On every start, so a database created by an older version (or before the
# password changed in srcs/.env) gets the role too: the read-only role of the
# backups and of postgres-exporter. pg_read_all_data lets pg_dump read every
# table; pg_monitor lets the exporter read the server statistics.
if [ -n "${POSTGRES_BACKUP_USER:-}" ] && [ -n "${POSTGRES_BACKUP_PASSWORD:-}" ]; then
    as_postgres psql -v ON_ERROR_STOP=1 --quiet \
        -v backup_user="$POSTGRES_BACKUP_USER" \
        -v backup_password="$POSTGRES_BACKUP_PASSWORD" <<-'EOSQL'
		SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', :'backup_user')
		WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'backup_user') \gexec
		ALTER ROLE :"backup_user" WITH LOGIN PASSWORD :'backup_password';
		GRANT pg_read_all_data, pg_monitor TO :"backup_user";
	EOSQL
else
    echo "WARNING: POSTGRES_BACKUP_USER or POSTGRES_BACKUP_PASSWORD is empty:" \
        "no read-only role, so no backups and no PostgreSQL metrics."
fi

# Only if one of the steps above started it.
if [ "${started:-0}" = 1 ]; then
    as_postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast -w stop
fi

# Volumes created before this rule allowed every address: narrow them too.
sed -i 's|^host all all 0\.0\.0\.0/0 |host all all samenet |' "$PGDATA/pg_hba.conf"

echo "Starting PostgreSQL..."

# The server does not need the passwords once the roles exist.
unset POSTGRES_PASSWORD POSTGRES_BACKUP_PASSWORD

# setpriv replaces this shell: postgres becomes PID 1 and receives the stop
# signals from Docker directly.
export HOME=/var/lib/postgresql
exec setpriv --reuid=postgres --regid=postgres --init-groups "$PG_BIN/postgres" -D "$PGDATA"
