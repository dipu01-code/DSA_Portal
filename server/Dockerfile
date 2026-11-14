# Multi-stage Dockerfile for @dsa-portal/server
FROM node:20-alpine AS base
WORKDIR /app

# Stage 1: Build dependencies & packages
FROM base AS builder
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY core/package.json ./core/
COPY server/package.json ./server/
COPY workers/package.json ./workers/
COPY cli/package.json ./cli/
COPY infra/package.json ./infra/
COPY scripts/package.json ./scripts/

RUN npm ci

COPY tsconfig.json ./
COPY core/ ./core/
COPY server/ ./server/

RUN npm run build -w core
RUN npm run build -w server

# Stage 2: Production runner
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache dumb-init wget

WORKDIR /app

COPY package.json package-lock.json ./
COPY core/package.json ./core/
COPY server/package.json ./server/

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/core/dist ./core/dist
# core reads its problem bank from core/problems at import time.
COPY --from=builder /app/core/problems ./core/problems
COPY --from=builder /app/server/dist ./server/dist
# tsc does not copy .sql files; the migrate service runs server/dist/db/migrate.js against these.
COPY --from=builder /app/server/src/db/migrations ./server/dist/db/migrations

# Served at /docs and /docs/openapi.yaml (app.ts looks for ../../docs/openapi.yaml).
COPY docs/openapi.yaml ./docs/openapi.yaml

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server/dist/index.js"]
