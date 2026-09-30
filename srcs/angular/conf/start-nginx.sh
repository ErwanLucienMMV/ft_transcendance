#!/bin/sh

envsubst '${APPPORT}' \
    < /etc/nginx/nginx.conf \
    > /tmp/nginx.conf

mv /tmp/nginx.conf /etc/nginx/nginx.conf

exec nginx -g "daemon off;"