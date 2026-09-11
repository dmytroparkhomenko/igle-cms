FROM node:22-alpine AS web
RUN apk add --no-cache git
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm --filter @igle/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@igle/web", "start"]
