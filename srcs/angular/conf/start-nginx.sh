#!/bin/sh
set -eu

# Only these variables are replaced: nginx's own $variables stay untouched.
envsubst '${APPPORT} ${APIPORT}' \
    < /etc/nginx/nginx.conf.template \
    > /etc/nginx/nginx.conf

exec nginx -g "daemon off;"
