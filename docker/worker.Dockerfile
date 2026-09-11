FROM node:22-alpine AS worker
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm --filter @igle/worker build
CMD ["pnpm", "--filter", "@igle/worker", "start"]
