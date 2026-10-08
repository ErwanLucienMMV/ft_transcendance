#!/bin/bash

set -e

DATE=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP="/backups/transcendence_${DATE}.sql.gz"

echo "Starting PostgreSQL backup... Please do not down this container during this action"

pg_dump | gzip > "$BACKUP"

echo "Backup created: $BACKUP"

## Remove backups from more than 24hours ago

echo "Removing old backups..."

find /backups -type f -name "transcendence_*.sql.gz" -mmin +1440 -delete

echo "Old backups cleaned."