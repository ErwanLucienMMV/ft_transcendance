#!/bin/sh
# The API port comes from srcs/.env (APIPORT), so the scrape target is
# written at start instead of being fixed in the image.
set -eu

sed "s/\${APIPORT}/${APIPORT:-3000}/g" \
    /etc/prometheus/prometheus.yml.template > /tmp/prometheus.yml

exec /bin/prometheus \
    --config.file=/tmp/prometheus.yml \
    --storage.tsdb.path=/prometheus \
    "$@"
