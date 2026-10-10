#!/bin/bash
set -euo pipefail
umask 077

DATE=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP="/backups/transcendence_${DATE}.sql.gz"

echo "Starting PostgreSQL backup... Please do not down this container during this action"

TEMP=$(mktemp "${BACKUP}.XXXXXX.partial")

# Supprime le fichier incomplet si le script échoue.
trap 'rm -f -- "$TEMP"' EXIT

pg_dump --no-password | gzip > "$TEMP"
gzip -t "$TEMP"

# Le fichier devient une sauvegarde disponible après réussite.
mv -- "$TEMP" "$BACKUP"

echo "Backup created: $BACKUP"

## Remove backups from more than 24hours ago

echo "Removing old backups..."

find /backups -type f -name "transcendence_*.sql.gz" -mmin +1440 -delete

echo "Old backups cleaned."