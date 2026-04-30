# syntax=docker/dockerfile:1.6
#
# Production image for @wimm/api.
#
# Build context must be the repo root (not apps/api/) so the workspace,
# shared package and lockfile are visible:
#   docker build -f apps/api/Dockerfile -t wimm-api .

FROM node:20-alpine

RUN apk add --no-cache tini openssl
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Workspace metadata first for better layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

# Install only api + shared (skip apps/desktop entirely)
RUN pnpm install --frozen-lockfile --filter @wimm/api... --filter @wimm/shared

# Sources
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Build shared package first (api consumes it via dist), then api
RUN pnpm --filter @wimm/shared build
RUN pnpm --filter @wimm/api build

EXPOSE 3000
WORKDIR /app/apps/api

ENTRYPOINT ["/sbin/tini", "--"]
# Run pending migrations on startup, then boot the api
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main"]
