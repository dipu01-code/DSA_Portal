# Multi-stage Dockerfile for @dsa-portal/workers
FROM node:20-alpine AS base
WORKDIR /app

# Stage 1: Build dependencies & packages
FROM base AS builder
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY core/package.json ./core/
COPY workers/package.json ./workers/
COPY server/package.json ./server/
COPY cli/package.json ./cli/
COPY infra/package.json ./infra/
COPY scripts/package.json ./scripts/

RUN npm ci

COPY tsconfig.json ./
COPY core/ ./core/
COPY workers/ ./workers/

RUN npm run build -w core
RUN npm run build -w workers

# Stage 2: Production runner
FROM base AS runner
ENV NODE_ENV=production

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY package.json package-lock.json ./
COPY core/package.json ./core/
COPY workers/package.json ./workers/

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/core/dist ./core/dist
COPY --from=builder /app/workers/dist ./workers/dist

USER node

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "workers/dist/index.js"]
