# Installation

## Local

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
cp .env.example .env
pnpm prisma:generate
pnpm prisma:migrate
pnpm dev
```

## Docker

```bash
docker compose up --build
```

Services:

- Web: `http://localhost:3000`
- Preview: `http://localhost:3001`
- Caddy reverse proxy: `http://localhost:8080`

Site repositories and build outputs live under `/data` in the `igle-data` Docker volume.
