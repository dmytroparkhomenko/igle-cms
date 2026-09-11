# Backup And Restore

The MVP backup service is not complete yet. The storage layout is ready for the required backup strategy:

- PostgreSQL dump for database-only state.
- `git bundle` per site repository under `/data/sites/{siteId}/repo`.
- Template archive under `/data/templates`.
- Build and export directories are reproducible or temporary and do not need to be primary backup sources.

Manual restore outline:

1. Restore PostgreSQL from the dump.
2. Restore each site repository from its Git bundle into `/data/sites/{siteId}/repo`.
3. Run the revision integrity check so every `SiteRevision.commitSha` is verified.
4. Rebuild any deployment artifact from the selected immutable revision.

An automated restore test is required for Milestone 9 and is not yet complete.
