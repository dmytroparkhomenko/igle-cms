# Architecture

Igle CMS follows the monorepo layout from Section 54.3 of the specification.

## Services

- `apps/web`: Next.js App Router UI and thin route handlers.
- `apps/worker`: background worker process entrypoint.
- `apps/preview`: separate Fastify preview origin. It serves site files and refuses `.igle/` paths.

## Packages

- `packages/shared`: Zod schemas, permission matrix, error shape, and safe path helpers.
- `packages/core`: domain services for sites, revisions, imports, SEO editing, drafts, jobs, scripts, redirects, and auth-domain records.
- `packages/html-engine`: parse5/Cheerio-based extraction and source-range patching. It does not reserialize whole documents for field edits.
- `packages/build`: exact revision materialization, build transforms, sitemap/robots generation, script injection, link warnings, footprint scan, and manifest generation.
- `packages/deployer`: deployment provider contracts, Nginx config generation, and local release deployment.
- `packages/ai`, `packages/templates`, `packages/integrations`: provider boundaries and early validation contracts for later milestones.

## Source Of Truth

The authoritative content for a site is the Git repository under `/data/sites/{siteId}/repo`, including versioned `.igle/` metadata. Database/page records are indexes of the current head revision.

Each meaningful site change creates one Git commit and one `SiteRevision` record. Restores create new commits; history is never rewritten.
