# syntax=docker/dockerfile:1
FROM node:22-alpine AS worker
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/preview/package.json apps/preview/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/build/package.json packages/build/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/deployer/package.json packages/deployer/package.json
COPY packages/html-engine/package.json packages/html-engine/package.json
COPY packages/integrations/package.json packages/integrations/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/templates/package.json packages/templates/package.json
COPY prisma prisma
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile=false

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @igle/worker typecheck

CMD ["pnpm", "--filter", "@igle/worker", "start"]
