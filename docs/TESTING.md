# Testing

Recommended checks:

```bash
pnpm test
pnpm smoke
pnpm typecheck
pnpm --filter @igle/web build
```

Current focused tests cover:

- permission matrix behavior for Administrator and Editor grants;
- HTML SEO extraction, ambiguity detection, and source-range patching;
- Git-backed revision creation, import, compare, restore, and integrity;
- build pipeline output, script injection, sitemap/robots generation, `.igle/` exclusion, and footprint failure;
- Nginx config validation and local release rollback.

Known local verification limitation:

After an interrupted Next.js production build in this environment, Vitest/tsx/tsc intermittently stalled or failed while loading module source. See `docs/IMPLEMENTATION_STATUS.md` for the exact observed results.
