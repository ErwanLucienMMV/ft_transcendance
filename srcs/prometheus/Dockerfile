FROM docker.io/prom/prometheus:v3.13.3

COPY prometheus.yml /etc/prometheus/prometheus.yml.template
COPY rules /etc/prometheus/rules
COPY entrypoint.sh /etc/prometheus/entrypoint.sh

ENTRYPOINT ["/bin/sh", "/etc/prometheus/entrypoint.sh"]
