#!/bin/sh
# The API port comes from srcs/.env (APIPORT), so the scrape target is
# written at start instead of being fixed in the image.
set -eu

sed "s/\${APIPORT}/${APIPORT:-3000}/g" \
    /etc/prometheus/prometheus.yml.template > /tmp/prometheus.yml

# Fails here, with the reason in `docker logs prometheus`, rather than
# running without its rules.
/bin/promtool check config /tmp/prometheus.yml > /dev/null

exec /bin/prometheus \
    --config.file=/tmp/prometheus.yml \
    --storage.tsdb.path=/prometheus \
    --storage.tsdb.retention.time=15d \
    "$@"
