FROM docker.io/library/debian:bookworm AS builder

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g npm@11 && \
    rm -rf /var/lib/apt/lists/*

COPY ./42chess/package*.json ./

RUN npm ci

COPY ./42chess/ ./

RUN npm run build


# ---------- Nginx ----------
FROM docker.io/library/debian:bookworm

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        nginx \
        openssl \
        gettext-base \
        && \
    rm -rf /var/lib/apt/lists/*

# Self-signed certificate for the local deployment. Replace both files with a
# real certificate (same paths) when serving a public domain.
RUN mkdir -p /etc/nginx/ssl /var/run/nginx && \
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
        -out /etc/nginx/ssl/transcendence.crt \
        -keyout /etc/nginx/ssl/transcendence.key \
        -subj "/C=FR/ST=IDF/L=Paris/O=42/OU=ft_transcendence/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

COPY conf/nginx.conf /etc/nginx/nginx.conf.template
COPY conf/security-headers.conf /etc/nginx/security-headers.conf

COPY --from=builder /app/dist/42chess/browser /usr/share/nginx/html

COPY conf/start-nginx.sh /start-nginx.sh
RUN chmod +x /start-nginx.sh

EXPOSE 80 443

CMD ["/start-nginx.sh"]
