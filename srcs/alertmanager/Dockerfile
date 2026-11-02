FROM docker.io/prom/alertmanager:v0.34.1

COPY alertmanager.yml /etc/alertmanager/alertmanager.yml
COPY entrypoint.sh /etc/alertmanager/entrypoint.sh

ENTRYPOINT ["/bin/sh", "/etc/alertmanager/entrypoint.sh"]
