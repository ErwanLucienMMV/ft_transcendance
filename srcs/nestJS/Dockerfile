FROM debian:bookworm

WORKDIR /app

# Node.js classic shit
RUN apt-get update && \
    apt-get install -y \
        curl \
        ca-certificates \
        && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@11 && \
    rm -rf /var/lib/apt/lists/*

# Dependencies
COPY ./42chess/package*.json ./

RUN npm ci

# Application
COPY ./42chess/ ./

# Build NestJS
RUN npm run build

CMD ["node", "dist/main.js"]