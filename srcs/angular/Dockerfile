FROM debian:bookworm as builder

WORKDIR /app

COPY ./42chess/package*.json ./

RUN apt-get update && \
    apt-get install -y \
        curl \
        ca-certificates \
        && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@11 && \
    rm -rf /var/lib/apt/lists/*

RUN npm ci

COPY ./42chess/ ./

RUN npm run build


# ---------- Nginx ----------
FROM debian:bookworm

RUN apt update

RUN apt install nginx -y

RUN apt install openssl -y

RUN mkdir -p /etc/nginx/ssl
# remplacer les localhost par l'url plus tard
RUN openssl req -x509 -nodes -out /etc/nginx/ssl/inception.crt -keyout /etc/nginx/ssl/inception.key -subj "/C=FR/ST=IDF/L=Paris/O=42/OU=42/CN=localhost/UID=localhost"

RUN mkdir -p /var/run/nginx

COPY conf/nginx.conf /etc/nginx/nginx.conf

COPY --from=builder /app/dist/42chess/browser /usr/share/nginx/html

EXPOSE 443

CMD ["nginx", "-g", "daemon off;"]