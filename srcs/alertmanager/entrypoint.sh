#!/bin/sh
# Alertmanager reads the webhook token from a file: it is written here from
# ALERT_WEBHOOK_TOKEN (generated in srcs/.env by `make env`), never stored in
# the image.
set -eu

if [ -z "${ALERT_WEBHOOK_TOKEN:-}" ]; then
    echo "ALERT_WEBHOOK_TOKEN is empty: run make env to generate it." >&2
    exit 1
fi
umask 077
printf '%s' "$ALERT_WEBHOOK_TOKEN" > /tmp/alert-webhook-token

# A single instance: no cluster to gossip with.
exec /bin/alertmanager \
    --config.file=/etc/alertmanager/alertmanager.yml \
    --storage.path=/alertmanager \
    --cluster.listen-address= \
    "$@"
