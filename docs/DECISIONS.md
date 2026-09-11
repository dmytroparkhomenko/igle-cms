# Decisions

This log records implementation choices where the specification is ambiguous or where a temporary implementation boundary matters.

## DEC-001: local development can use the filesystem service before Prisma wiring

- Related requirements: STO-01, REV-01..REV-09, SOT-01..SOT-03, Section 65 Milestone 1.
- Decision: the domain services are written against explicit repository interfaces and include a filesystem-backed implementation used by the CLI, tests, and local smoke runs. The Prisma schema and migration define the production persistence model, but route handlers are intentionally thin and can swap in the Prisma-backed repositories without moving business logic out of `packages/core`.
- Rationale: this gives a working Git-backed revision engine early, keeps source-of-truth behavior in real files and commits, and avoids pretending that a database adapter is complete before it is wired through every service.

## DEC-002: Git command wrapper is used behind the revision service

- Related requirements: REV-03..REV-09, Section 3 revision store.
- Decision: the initial revision service shells out to the system `git` binary through a small wrapper. The package still includes `simple-git`, and the wrapper boundary is narrow enough to replace with `simple-git` without changing service behavior.
- Rationale: the system Git binary is the actual storage engine required by the spec. The wrapper makes no history-rewriting operations available, which helps enforce REV-05.

## DEC-003: first runnable authentication is service-level, Better Auth integration remains pending

- Related requirements: AUTH-01..AUTH-06, ROLE-01..ROLE-05, Section 3 authentication.
- Decision: Milestone 1 includes real password hashing, invite tokens, TOTP secret enrollment records, session records, and server-side permission checks in core services. Full Better Auth route integration is not marked complete yet.
- Rationale: the spec's security behavior is represented in the domain model first, while UI/session plumbing remains a clearly tracked remaining task rather than a stubbed claim.

## DEC-004: preview serves static files only and excludes `.igle/`

- Related requirements: STO-02, PREV-01.., FP-07, Section 36.
- Decision: the preview service serves the materialized draft Git working tree on a separate port and blocks any `.igle/` path. Editor bridge injection is not implemented or claimed complete.
- Rationale: separate-origin static preview is useful immediately for imported sites and is the safest incomplete slice.
