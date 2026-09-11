# Igle CMS

Igle CMS is a static-site CMS implementation following `Igle_CMS_Technical_Task_v2.md`.

## Current implementation state

This repository currently implements a runnable Milestone 1 foundation and selected Milestone 2 core services:

- pnpm monorepo layout from Section 54.3.
- shared Zod schemas for `.igle/` metadata.
- server-side permission matrix for Administrator and Editor grants.
- Git-backed revision service with one repository per site, sequential revision numbers, compare, restore, and integrity checks.
- filesystem storage layout compatible with `/data/sites/{siteId}/repo`.
- secure import helpers that reject traversal, absolute paths, symlinks, hard links, device files, and ignored OS files.
- HTML engine for SEO extraction, ambiguity detection, and patch-based Title/Description/H1 writes.
- draft store outside the Git repository.
- in-process job service with SSE-compatible progress events and resumable job records.
- minimal Next.js web app shell, Fastify preview service, and worker service entrypoints.
- Prisma schema and initial migration for the required database entities.
- deterministic revision build pipeline with sitemap/robots generation, script injection, link/asset warnings, footprint scan, and manifest output.
- Nginx configuration generator with strict input validation.
- local release deployment provider with release directories, atomic `current` activation, smoke checks, and rollback-on-failure.
- Docker Compose with PostgreSQL, Redis, web, worker, preview, and Caddy.

Unfinished deployment, AI, visual editing, template generation, BeMob, and production-hardening work is recorded in `docs/IMPLEMENTATION_STATUS.md`; no core feature is reported as complete unless code exists for it.

## Local setup

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
cp .env.example .env
pnpm prisma:generate
pnpm prisma:migrate
pnpm test
pnpm dev
```

The web app runs on `http://localhost:3000`; preview runs on `http://localhost:3001`.

## Docker

```bash
docker compose up --build
```

Docker stores site repositories under the named `igle-data` volume mounted at `/data`.

## CLI smoke commands

```bash
pnpm igle setup-admin --email admin@example.com --password 'change-me'
pnpm igle create-blank-site --name "Demo" --slug demo
pnpm igle import-directory --site demo --source fixtures/site-basic
pnpm smoke
```

## Acceptance discipline

See `docs/IMPLEMENTATION_STATUS.md` for implemented requirements, verification commands, and remaining milestones. Ambiguities are recorded in `docs/DECISIONS.md`.
# igle-cms
