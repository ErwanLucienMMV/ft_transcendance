#!/bin/bash

set -e

PGDATA="/var/lib/postgresql/data"
PG_BIN="/usr/lib/postgresql/15/bin"

mkdir -p "$PGDATA"
chown -R postgres:postgres "$PGDATA"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "Initializing PostgreSQL..."

    su - postgres -c "$PG_BIN/initdb -D '$PGDATA'"

    sed -i "s/^#listen_addresses = 'localhost'/listen_addresses = '*'/" \
        "$PGDATA/postgresql.conf"

    echo "host all all 0.0.0.0/0 scram-sha-256" >> \
        "$PGDATA/pg_hba.conf"

    echo "Starting PostgreSQL temporarily..."

    su - postgres -c "$PG_BIN/pg_ctl -D '$PGDATA' -o \"-c listen_addresses='localhost'\" -w start"

    su - postgres -c "psql -v ON_ERROR_STOP=1" <<-EOSQL
        CREATE USER ${POSTGRES_USER} WITH PASSWORD '${POSTGRES_PASSWORD}';
        CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};
EOSQL

    su - postgres -c "$PG_BIN/pg_ctl -D '$PGDATA' -m fast -w stop"
fi

echo "Starting PostgreSQL..."

exec su - postgres -c "$PG_BIN/postgres -D '$PGDATA'"