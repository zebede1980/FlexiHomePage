# The hosted site: the page (dist-web) and the server that keeps its bookmarks.
# The same image also runs the probe sidecar; see docker-compose.yml.

# ─── Builder ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:web && npm run build:server

# Drop the build-only dependencies from node_modules.
RUN npm prune --omit=dev

# ─── Runtime ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    WEB_DIR=/app/dist-web

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist-web ./dist-web
COPY --from=builder --chown=node:node /app/dist-server ./dist-server
# `docker exec -it flexihome flexihome reset-password` and friends.
COPY --chmod=755 bin/flexihome /usr/local/bin/flexihome

# /app/data holds the SQLite database and the site-icon cache.
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || wget -qO- http://127.0.0.1:${PORT}/health || exit 1

# node:sqlite is still flagged experimental in Node 22; it works, so hush the warning.
CMD ["node", "--disable-warning=ExperimentalWarning", "dist-server/index.js"]
