# Igle CMS

*[中文说明 / Chinese version](README.zh-CN.md)*

Igle CMS is a static-site CMS purpose-built for running a portfolio of affiliate and PBN (private blog network) sites: import or generate a site from a template, edit it visually or in code, manage its SEO, cloak its affiliate links, and deploy it to a real VPS panel (aaPanel or CloudPanel) — all from one admin app, with every meaningful change tracked as a Git commit.

This README describes the codebase as it actually is today, verified against the code rather than against the original design spec. Older documents under `docs/` (`ARCHITECTURE.md`, `IMPLEMENTATION_STATUS.md`, `DECISIONS.md`, `INSTALL.md`, `BACKUP_RESTORE.md`) describe an early "Milestone 1" snapshot of the project and are stale — don't treat them as current.

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Feature tour](#feature-tour)
- [Affiliate link cloaking](#affiliate-link-cloaking)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [CLI](#cli)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Operational notes](#operational-notes)

## What it does

A small team manages many static affiliate/PBN sites from one place:

- Spin up a new site from a template, a zip upload, or a directory import.
- Edit pages with a real click-to-select visual editor (text, images, styling, block reordering), a raw code editor, or field-level SEO forms — all three write through the same Git-backed revision pipeline.
- Mark buttons/links/images as affiliate CTAs; route them by country (or override per site) without hardcoding a real destination URL into the page.
- Manage domains through Cloudflare, assign servers, and deploy to a VPS panel with SSL, a smoke test, and automatic rollback on failure.
- Track team tasks, get notified in-app or via Telegram, and keep a full audit trail of every change to every site.

## Architecture

**Monorepo** (pnpm workspaces, `apps/*` + `packages/*`):

| Package | Role |
|---|---|
| `apps/web` | The admin app — Next.js 15 (App Router), the UI for everything above. |
| `apps/preview` | A standalone Fastify server that serves a site's raw files on their own origin, and injects the visual editor's bridge script (edit mode) and the affiliate click-redirect script. |
| `apps/worker` | A long-running Node process: periodic sweeps for task-archiving, deadline reminders, and pending aaPanel auto-imports. |
| `packages/core` | All domain services — sites, pages, revisions, templates, deploys, domains, affiliate links, scripts, tasks, notifications, auth, and more. |
| `packages/html-engine` | HTML parsing/patching (parse5 + Cheerio + magic-string): SEO field extraction, source-range patches, the visual editor's node-id patch engine, affiliate CTA tagging. |
| `packages/build` | `buildSite()` — turns one exact Git revision into a deployable static build (scripts, sitemap/robots, canonical/hreflang, the baked affiliate click script, a footprint scan, a file manifest). |
| `packages/deployer` | Deploy/provider integrations: aaPanel, CloudPanel (over SSH), Cloudflare, Vultr, Telegram, an Nginx config generator, and the local release provider. |
| `packages/templates` | Nunjucks-based template rendering. |
| `packages/shared` | Zod schemas, the permission matrix, shared error types and path helpers. |
| `packages/ai`, `packages/integrations` | Thin interface stubs — no real implementation exists behind either yet. |

**Persistence — read this before assuming Postgres:**

- The actual source of truth is **`state.json`** — one JSON file under `IGLE_DATA_DIR`, read and written through `JsonStateStore` (`packages/core/src/state-store.ts`). Writes are atomic (write-then-rename) and guarded by a cross-process file lock, both added after real production incidents (a corrupted state file, and two aaPanel import runs racing on the same domain).
- Each site's actual content (HTML/CSS/JS/media + its own `.igle/*.json` metadata) lives in **its own Git repository** under `data/sites/{siteId}/repo`. Every meaningful change is one commit plus one tracked revision record — see [Operational notes](#operational-notes).
- **Prisma/Postgres are present in the repo (`prisma/`, the `postgres` service in Docker Compose) but not used anywhere at runtime** — no code imports `@prisma/client`. Treat them as legacy scaffolding.
- **Redis is in `docker-compose.yml` and `REDIS_URL` is read by the worker, but nothing actually connects to it** — BullMQ is a dependency but no `Queue`/`Worker` is instantiated anywhere. The worker runs plain `setInterval` polling loops instead.

## Feature tour

**Sites** — create blank, from a template, or by importing a zip/directory. Per-site settings for domain, URL style, HTTPS, language/locale/GEO, category (`affiliate` vs `pbn`), deployment target, favicon, sitemap/robots behavior, canonical-domain "gluing" with hreflang, and an affiliate link override. Trash (soft delete/restore/purge) for pages, a typed-confirmation hard delete for sites, site-wide "apply language to all pages" and "fix internal links" utilities.

**Templates** — a gallery of built-in templates, plus uploading your own static HTML zip as a custom template (every `.html` file becomes a page type; internal links get rewritten to the CMS's clean-URL layout; titles/descriptions become Nunjucks placeholders; affiliate CTAs get auto-tagged on ingest). Update a template in place from a new zip without touching sites already built from the old version.

**Page editing**, three surfaces feeding the same revision pipeline:
- *SEO fields* — title, meta description, H1, canonical, robots, OG tags, `<html lang>`, sitemap inclusion — each field tracks its own state (inherited / explicit / hand-edited / ambiguous) so the CMS never silently overwrites something you edited by hand.
- *Code editor* — the page's own raw HTML (header/footer are edited once, site-wide, and excluded here).
- *Visual editor* — click an element in a live iframe to select it. Double-click text to edit it in place, or open a rich-text/raw-HTML panel for a whole section. Replace an image (propagates to every other page using the same file). Move a block up/down among its siblings, duplicate it, remove it. Style controls (text/background color, border, corner radius, padding, shadow, font, text align/transform, letter-spacing, hover state) applied with `!important` so they reliably win over a template's own CSS. Mark a link, button, or image as an affiliate CTA (deliberately *not* offered on whole sections — see below). Undo/redo, discard, fullscreen, and a one-click sync of this page's header/footer to every other page.

**Revisions** — one Git repo per site; every save is a commit with a tagged source (visual editor, code editor, import, template, bulk edit, and 25+ other origins). Compare any two revisions as a real diff. Restore a historical revision as a *new* commit — history is never rewritten. An integrity check confirms every tracked commit still exists and `HEAD` matches the latest revision.

**Deployment** — build once (`buildSite()`), then ship to local release directories, aaPanel (its REST API), or CloudPanel (SSH + `clpctl`, since it has no REST API). Each path: uploads the build, issues SSL, runs a live smoke test, and — for local deploys — automatically rolls back to the previous release if the smoke test fails. Deploying a site also deploys its mirror partner, if it has one.

**Domains** — connect a domain through Cloudflare (creates the zone, a proxied record, sets SSL mode to `full`), track propagation, then issue a real origin certificate via the assigned panel and flip Cloudflare to `strict`. Multiple named Cloudflare accounts, kept separate on purpose.

**SEO tooling** — sitemap/robots generation, per-site canonical "domain gluing," hreflang (explicit targets or automatic mirror-pair reciprocity), site-wide default meta-robots, and file-based Google Search Console / Bing Webmaster verification with a live reachability check.

**Scripts** — per-site custom `<script>` snippets (placement, environment, page scope, enable/disable), with built-in GA4/GTM presets and duplicate-tracking-ID detection.

**Mirroring** — a full content copy of a site under a second `SiteRecord`, for running the same content under a different domain/canonical/hreflang configuration. Connect, resync, or disconnect a pair; deploys cascade across the pair automatically.

**Tasks** — a lightweight, team-wide ticketing system: priority, status, deadlines, comments, a checklist with its own per-item assignees, file attachments, and a full activity log. Weekly auto-archiving of finished tasks and once-per-deadline reminders run from the worker.

**Notifications** — in-app notifications are always written; Telegram delivery is a fail-silent bonus channel (one shared bot token, each user links their own chat ID).

**Team & auth** — one shared team password plus mandatory per-user 2FA (TOTP, with one-time backup codes); two roles (administrator / editor) with a small, explicit permission matrix — no per-site access grants. A separate "restricted server" gate applies only to affiliate sites; PBN sites bypass it by design.

**Servers** — register aaPanel or CloudPanel servers, mark them restricted, and (for aaPanel) let the worker auto-import every site already hosted on that panel in the background, classifying each as static, WordPress, MODX, or generic PHP so a dynamic site never gets silently overwritten by a stale snapshot.

**Redirects, media, and Vultr** round out the toolbox: per-site 301/302 redirects (loop- and chain-safe), image upload handling, and read-only Vultr instance discovery to pre-fill a new server's IP.

## Affiliate link cloaking

This is the subsystem most worth understanding in detail, because its design is deliberate and non-obvious.

**The rule a real visitor's click must never break: it never touches the CMS's own server.** An earlier version of this feature routed every click through a CMS-hosted redirect endpoint, looked up live. That was replaced — routing traffic through one shared, fingerprintable origin ties every managed site back together, which defeats the point of running a diversified portfolio of sites. The trade made instead: changing a link only takes effect on that site's **next Deploy**, not instantly.

How it works end to end:

1. **Tagging** — `tagAffiliateCtas()` auto-detects CTA anchors on template upload and site creation (a dead `#`-style href, `rel="sponsored"`, a known CTA class, or an existing dynamic-link marker), marks them `data-igle-cta="<slot>"`, and neutralizes any real URL already sitting in the `href` so it's never crawlable in the raw HTML. It deliberately does *not* guess from an arbitrary external link alone — a real compliance/regulator link must never be cloaked by accident.
2. **Manual marking** — in the visual editor, "Mark as affiliate link" wraps the selected element in a fresh `<a data-igle-cta>`. Offered only on links, buttons, and images — never a section or other container, so you can't accidentally turn a whole block of the page into one giant link.
3. **Routing** — an admin sets one destination URL per country in Integrations; a site can override it with its own link. Resolution is: site override → country default → nothing configured.
4. **Baking** — at Deploy time, the resolved URL is baked as a literal string directly into a small click-redirect script, and `data-igle-cta` is renamed to the neutral, non-CMS-branded `data-go` attribute in the shipped output. A build's "footprint scanner" rejects any leftover CMS marker in the final files, which is exactly what this rename keeps clean even when no link is configured yet.
5. **On click** — one delegated listener on `document`, keyed off `data-go`; on match it intercepts the click and navigates to the baked URL, entirely client-side, on the site's own domain. Zero requests to the CMS.
6. **In the CMS's own preview**, the same script is injected (keyed off the still-unrenamed `data-igle-cta`) so a marked CTA is actually testable before you ever deploy.

## Tech stack

- **Next.js 15** / **React 19**, TypeScript throughout with a strict, shared `tsconfig.base.json`.
- **Zod** for every schema; **parse5 + Cheerio + magic-string** for spec-accurate, patch-based HTML editing (never a blind re-serialize).
- **Fastify** for the preview server; plain Next.js route handlers for the admin app's API.
- **`bcryptjs` + `otpauth`** for password hashing and TOTP 2FA; **`ssh2`** for CloudPanel's SSH-based deploys; **`nunjucks`** for template rendering; **`@tiptap/*`** for the visual editor's rich-text panel; **`qrcode`** for 2FA setup.
- Git operations shell out to the system `git` binary directly (revisions, diffs, restores, build materialization) rather than going through a JS Git library.
- Shipped as **Docker Compose**: `web`, `preview`, `worker`, `postgres`, `redis`, and `caddy` as a reverse proxy — see the persistence note above for which of those are actually load-bearing today.

## Getting started

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
cp .env.example .env   # set ADMIN_EMAIL / ADMIN_PASSWORD to bootstrap the first admin account
pnpm dev                # apps/web on :3000
pnpm dev:preview         # apps/preview on :3001 (separate terminal)
pnpm dev:worker          # apps/worker (separate terminal — task sweeps, aaPanel auto-import)
```

The env vars that actually matter at runtime:

| Variable | Used for |
|---|---|
| `IGLE_DATA_DIR` | Where `state.json`, every site's Git repo, releases, and builds live. |
| `WEB_ORIGIN` | The admin app's own public address — used for Telegram deep links, and must be a real, publicly reachable address (not `localhost`) for any deployed site's cloak scripts or preview links to work correctly. |
| `PREVIEW_ORIGIN` | The preview server's address. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | First-run only — bootstraps the first administrator account and the shared team password. No-op once any user exists. |
| `AAPANEL_BASE_URL` / `AAPANEL_API_KEY` | Optional — auto-registers one legacy aaPanel server on first run. New servers are normally added through the Servers screen instead. |

`DATABASE_URL`, `REDIS_URL`, and `BETTER_AUTH_SECRET` are present in `.env.example` for the Docker Compose services they configure, but nothing in the application code actually depends on them — see [Architecture](#architecture).

### Docker

```bash
docker compose up --build
```

All persistent CMS data (the state file, every site's repo, releases, builds, task attachments) lives under the `igle-data` volume, mounted at `/data` in `web`, `preview`, and `worker`.

## CLI

```bash
pnpm igle setup-admin --email admin@example.com --password 'change-me'
pnpm igle create-blank-site --name "Demo" --slug demo
pnpm igle import-directory --site demo --source fixtures/site-basic
pnpm igle list-sites
pnpm igle dedupe-sites [--confirm true]   # cleans up sites double-imported from the same aaPanel server
pnpm smoke
```

## Testing

```bash
pnpm -r typecheck   # every package/app, strict TypeScript
pnpm test           # Vitest — build, deployer, domain-service, html-engine, permissions, revision-import, state-store, template-builder
```

## Project layout

```
apps/
  web/        Next.js admin app — every screen and API route
  preview/    Fastify server — serves raw site files + the visual editor bridge
  worker/     background sweeps (tasks, aaPanel auto-import)
packages/
  core/       domain services (sites, pages, revisions, deploy, domains, affiliate links, tasks, auth, ...)
  html-engine/  HTML parsing, patching, SEO extraction, affiliate CTA tagging
  build/      turns a Git revision into a deployable static build
  deployer/   aaPanel, CloudPanel, Cloudflare, Vultr, Telegram, Nginx, local-release providers
  templates/  Nunjucks template rendering
  shared/     Zod schemas, permission matrix, error types
  ai/         interface stub — no implementation yet
  integrations/  interface stub — no implementation yet
templates/    built-in site templates
fixtures/     test fixtures
scripts/      igle.ts CLI, smoke test, launcher
docker/       Dockerfiles + Caddy config
tests/        Vitest suites
```

## Operational notes

- **Node-id HTML patching** — the visual editor never re-serializes a page. Every element gets a throwaway `data-igle-node` id at edit time only; patches reference elements by that id and are applied as precise source-range overwrites, so untouched markup (including hand-authored formatting) survives byte-for-byte.
- **The footprint scanner** rejects any leftover CMS marker (`data-igle-`, the editor bridge, etc.) anywhere in a build's final output as a hard build error — the guarantee that no authoring artifact ever ships to a live, public site.
- **Content-lock** — a site auto-imported from aaPanel and detected as WordPress, MODX, or otherwise PHP-dynamic gets locked against further CMS edits/deploys automatically, since the CMS only ever holds a stale file snapshot of it and deploying that snapshot could overwrite — or on CloudPanel, delete — the real live install. An admin's manual lock/unlock always takes priority over what a later auto-detection finds.
- **Restricted servers are an affiliate-only gate** — an editor can't deploy to, or assign a domain on, a server marked restricted, but a PBN-category site bypasses that gate regardless of who's acting.
- **Per-site write lock** — edits to one site are serialized in-process to prevent two near-simultaneous changes from racing and silently dropping one of them. This lock is in-memory only and does not extend across multiple `web` instances if the app is ever horizontally scaled.
- **`state.json`'s atomic writes and cross-process file lock** exist because of two real past incidents (a corrupted state file, and two aaPanel imports racing on the same domain) — worth keeping in mind if you're changing how or how often it's written.
- **aaPanel auto-import** runs on a background poll, rate-limits itself with a circuit breaker, and self-heals any import left stuck "running" by a worker crash or restart.
