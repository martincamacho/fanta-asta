# Fanta Asta — imagen única: server Fastify+Socket.IO sirviendo la SPA compilada
FROM node:22-slim AS base
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @fanta/web build

ENV NODE_ENV=production
ENV PORT=3001
# En hosting con volumen persistente: DB_PATH=/data/fanta.sqlite (ver fly.toml)
EXPOSE 3001
CMD ["pnpm", "--filter", "@fanta/server", "start"]
