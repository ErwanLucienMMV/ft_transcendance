FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY test ./test

RUN node --test && rm -rf test

# No root needed to send emails.
USER node

# Internal port only: never published, never routed by nginx.
CMD ["node", "src/index.js"]
