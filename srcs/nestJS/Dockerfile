FROM docker.io/library/debian:bookworm AS node

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*


# ---------- Build and unit tests ----------
FROM node AS build

WORKDIR /app

RUN npm install -g npm@11

COPY ./42chess/package*.json ./
RUN npm ci

COPY ./42chess/ ./
RUN npm run build

# Unit tests only: DB and e2e suites run with make test
RUN npm test

# The runtime image only needs production dependencies.
RUN npm prune --omit=dev


# ---------- Runtime ----------
FROM node

WORKDIR /app

RUN useradd --system --create-home --uid 10001 app && \
    mkdir -p /app/uploads && chown app:app /app/uploads

COPY --from=build --chown=app:app /app/package.json /app/package-lock.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/data ./data

USER app

CMD ["node", "dist/main.js"]
