# Implementation Status

## Milestone 1 — Foundation

Implemented:

- Monorepo structure, TypeScript strict configuration, Docker Compose, Prisma schema, and initial SQL migration.
- Shared `.igle/` metadata schemas with validation on read/write paths used by core services.
- Permission matrix for Administrator and Editor grants, including `canEditCode` and `canDeploy`.
- First-admin, invite-token, session, password-hashing, and TOTP enrollment data structures in `AuthService`.
- Git-backed `RevisionService`: create repositories, create immutable sequential revisions, compare revisions, restore historical revisions as new commits, and run integrity checks.
- `SiteService`: create blank sites with Revision #1 and `.igle/` metadata.
- `DraftService`: stores unsaved drafts outside the Git repository.
- `JobService`: records jobs and emits progress events suitable for SSE.
- HTML engine fixture corpus and skeleton parser/patcher.

Not fully complete:

- Better Auth integration in Next.js route handlers.
- Real Redis/BullMQ worker restart recovery. The job model exists; the current worker is an entrypoint and does not yet rehydrate processors from Redis.
- Full audit-log persistence through every endpoint.

## Milestone 2 — Import + Essential Editing

Implemented:

- Secure import validation helpers for ZIP-entry style paths.
- Directory importer used by tests/CLI that copies static site files, creates `.igle/pages.json`, indexes HTML pages, and commits a real import revision.
- SEO extraction for Title, Description, H1, language, canonical, robots, Open Graph title/description, images, counts, missing ALT, word count, and ambiguous duplicate fields.
- Patch-based field writer for Title, Description, and simple text H1 edits.
- Code-save path that re-parses fields and marks changed recognized fields as `manual-source`.
- Revision compare and restore services.
- Separate-origin preview service that serves site files and refuses `.igle/`.

Not fully complete:

- Browser ZIP upload UI, quarantine lifecycle, encoding conversion UI, and background import job orchestration.
- Bulk SEO editor UI and API.
- Full Versions page UI with structured diff display.
- Full preview editor refresh/presence behavior.

## Milestones 3-9

## Milestone 3 — Servers, Provisioning, Deployment

Implemented:

- Build pipeline service that archives an exact Git revision, removes `.igle/`, excludes static-site server-side files and `.htaccess`, injects production/both custom scripts, writes sitemap and CMS-generated robots.txt, validates missing root `index.html`, scans links/assets, blocks footprint markers, and emits a build manifest.
- Nginx provider interface with strict domain/path/redirect validation and generated config for URL-style handling, ACME challenge path, gzip, and basic security headers.
- Local release deployment provider implementing `releases/...` plus `current` symlink activation, smoke check, and rollback-on-failure behavior.
- Redirect metadata service that stores redirects in `.igle/redirects.json`, rejects unsafe input, rejects loops, rejects chains longer than one hop, and creates a revision.

Not fully complete:

- Real SSH/rsync provider, host-key pinning, setup assistant, and VPS connection tests.
- Certbot/SSL provisioning and real `nginx -t` application flow.
- Full deployment UI, persisted deployment logs, target locking, remote release cleanup, and historical deploy selection.
- Full link checker classification UI and deploy acknowledgement workflow.

## Milestone 7 — Search Engine Verification + Custom Scripts

Implemented early because the Milestone 3 build pipeline depends on it:

- Script metadata schema for environment, placement, enabled state, page scoping, and owner.
- Script service for adding custom scripts to `.igle/scripts.json`, duplicate code hash detection, GA/GTM tracking ID duplicate detection, and revision creation.

Not fully complete:

- Google/Bing verification manager UI/API.
- Production reachability checks and byte-identical verification file checks.
- GA4/GTM preset forms and hard-coded tracking-ID audit warnings.
- Section 71 acceptance workflow.

## Milestones 4-6, 8-9

Remaining. The repository contains package boundaries for media, visual editing, AI, templates, integrations, build, deployer, and hardening, but product features are not claimed complete until their providers, tests, and acceptance flows are implemented.

## Verification

Observed in this environment:

- `pnpm install` completed after Corepack/pnpm cache approval.
- `pnpm test` completed successfully once: 3 test files, 9 tests passed.
- `pnpm typecheck` completed successfully through `@igle/shared`, `@igle/html-engine`, `@igle/core`, `@igle/build`, `@igle/deployer`, `@igle/integrations`, `@igle/ai`, `@igle/templates`, `@igle/worker`, and `@igle/preview`.
- `@igle/web` production build initially failed on TypeScript source extension resolution; `apps/web/next.config.ts` was updated to resolve `.js` imports to workspace TypeScript source and to pin `outputFileTracingRoot`.
- After that fix, the Next.js production build stayed at "Creating an optimized production build ..." for several minutes in this environment and was stopped. Web production build is therefore not claimed verified.
- Later Vitest reruns became unstable/silent after the stopped Next build, despite the previous passing run and direct JSON validation of the reported package file. This is recorded as an environment verification issue.
- A later `pnpm smoke` run reached Node module loading and then failed with `ETIMEDOUT` while Node was reading module source. No application assertion failed in that run.

Recommended verification commands:

```bash
pnpm install
pnpm test
pnpm typecheck
docker compose up --build
```

The current environment did not have `pnpm` installed before repository creation. Use Corepack as shown in `README.md`.
