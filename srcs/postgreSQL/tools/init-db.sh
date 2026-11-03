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

    # Values are passed as psql variables (:"name" for identifiers, :'name'
    # for literals) so they are quoted by psql, never pasted into the SQL.
    as_postgres psql -v ON_ERROR_STOP=1 \
        -v app_user="$POSTGRES_USER" \
        -v app_password="$POSTGRES_PASSWORD" \
        -v app_db="$POSTGRES_DB" \
        -v backup_user="$POSTGRES_BACKUP_USER" \
        -v backup_password="$POSTGRES_BACKUP_PASSWORD" <<-'EOSQL'
		CREATE USER :"app_user" WITH PASSWORD :'app_password';
		CREATE DATABASE :"app_db" OWNER :"app_user";
		CREATE ROLE :"backup_user" WITH LOGIN PASSWORD :'backup_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
		GRANT pg_read_all_data TO :"backup_user";
	EOSQL

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
