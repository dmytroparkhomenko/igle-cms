FROM node:22-alpine AS preview
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm --filter @igle/preview build
EXPOSE 3001
CMD ["pnpm", "--filter", "@igle/preview", "start"]
