FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        postgresql-client \
        cron \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /backups

COPY ./tools/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

COPY ./tools/crontab /etc/cron.d/transcendence-backup
RUN chmod 0644 /etc/cron.d/transcendence-backup \
    && crontab /etc/cron.d/transcendence-backup

# Copy the actual rollback script here so it can run detached from prod
COPY ./tools/restore.sh /usr/local/bin/restore.sh
RUN chmod +x /usr/local/bin/restore.sh

CMD ["cron", "-f"]