import path from "node:path";
import { AuthService, ImportService, JsonStateStore, RevisionService, SiteService } from "@igle/core";
import type { Actor } from "@igle/shared";

const dataDir = process.env.IGLE_DATA_DIR ?? path.resolve(process.cwd(), "data");
const stateStore = new JsonStateStore(dataDir);
const revisionService = new RevisionService(stateStore);
const siteService = new SiteService(dataDir, stateStore, revisionService);
const authService = new AuthService(stateStore);
const importService = new ImportService(stateStore, revisionService);
const systemActor: Actor = { id: "cli", email: "cli@igle.local", role: "administrator" };

const [command, ...args] = process.argv.slice(2);
const options = parseArgs(args);

switch (command) {
  case "setup-admin": {
    const email = required(options, "email");
    const password = required(options, "password");
    const user = await authService.createFirstAdministrator({ email, password });
    console.log(JSON.stringify({ user: { id: user.id, email: user.email, role: user.role } }, null, 2));
    break;
  }
  case "create-blank-site": {
    const site = await siteService.createBlankSite(
      {
        name: required(options, "name"),
        slug: required(options, "slug"),
        language: options.language,
        locale: options.locale
      },
      systemActor
    );
    console.log(JSON.stringify({ siteId: site.id, slug: site.slug, repoPath: site.repoPath }, null, 2));
    break;
  }
  case "import-directory": {
    const site = await siteService.get(required(options, "site"), systemActor);
    if (!site) throw new Error("Site not found.");
    const result = await importService.importDirectory(site, path.resolve(required(options, "source")), systemActor);
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "list-sites": {
    console.log(JSON.stringify({ sites: await siteService.list(systemActor) }, null, 2));
    break;
  }
  case "dedupe-sites": {
    await dedupeSites(options.confirm === "true");
    break;
  }
  default:
    console.log(`Igle CMS CLI

Commands:
  setup-admin --email <email> --password <password>
  create-blank-site --name <name> --slug <slug>
  import-directory --site <site id or slug> --source <directory>
  list-sites
  dedupe-sites [--confirm true]
`);
}

/**
 * One-time cleanup for sites imported twice from the same aaPanel server — a name collision (an
 * import always names a site after its domain, so two sites sharing a name are the same real site
 * imported twice) where exactly one copy has the domain and every domain-less sibling has no more
 * content and was never deployed. Default is a dry-run report; pass --confirm true to actually
 * delete. Anything less clear-cut (no copy has the domain, more than one does, or a domain-less
 * copy has more pages or its own deploy history) is only ever reported, never touched — the
 * uniqueness bug this cleans up after is now fixed at the source (see RemoteSiteImportService and
 * SiteService.updateSettings), so this should be a one-off, not something run routinely.
 */
async function dedupeSites(confirmed: boolean): Promise<void> {
  const state = await stateStore.read();

  const mirrorSiteIds = new Set<string>();
  for (const site of state.sites) {
    if (site.metadata.mirrorOfSiteId) {
      mirrorSiteIds.add(site.id);
      mirrorSiteIds.add(site.metadata.mirrorOfSiteId);
    }
  }

  const byName = new Map<string, typeof state.sites>();
  for (const site of state.sites) {
    if (mirrorSiteIds.has(site.id)) continue;
    const key = site.metadata.name.trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(site);
  }

  const pageCount = (siteId: string) => state.pages.filter((page) => page.siteId === siteId && !page.deletedAt).length;

  const toDelete: Array<{ site: (typeof state.sites)[number]; groupName: string }> = [];
  const needsReview: Array<{ groupName: string; sites: typeof state.sites }> = [];

  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const domained = group.filter((site) => site.metadata.domain);
    const domainless = group.filter((site) => !site.metadata.domain);

    if (domained.length === 1) {
      const keeper = domained[0]!;
      const keeperPages = pageCount(keeper.id);
      const safeToDrop = domainless.length > 0 && domainless.every((site) => pageCount(site.id) <= keeperPages && !site.productionRevisionId);
      if (safeToDrop) {
        for (const site of domainless) toDelete.push({ site, groupName: name });
        continue;
      }
    }
    needsReview.push({ groupName: name, sites: group });
  }

  const duplicateGroupCount = [...byName.values()].filter((group) => group.length > 1).length;
  console.log(`\nDuplicate scan: ${byName.size} names checked, ${duplicateGroupCount} group(s) with more than one site.\n`);

  if (toDelete.length > 0) {
    console.log(`${confirmed ? "Deleting" : "Would delete"} ${toDelete.length} site(s):\n`);
    for (const { site, groupName } of toDelete) {
      console.log(`  [${groupName}] ${site.slug} (id=${site.id}, ${pageCount(site.id)} pages, no domain, created ${site.metadata.createdAt})`);
    }
    console.log("");
  }

  if (needsReview.length > 0) {
    console.log(`${needsReview.length} group(s) need manual review — not touched:\n`);
    for (const { groupName, sites } of needsReview) {
      console.log(`  ${groupName}:`);
      for (const site of sites) {
        console.log(
          `    - ${site.slug} (id=${site.id}, domain=${site.metadata.domain ?? "none"}, ${pageCount(site.id)} pages, deployed=${Boolean(site.productionRevisionId)}, created=${site.metadata.createdAt})`
        );
      }
    }
    console.log("");
  }

  if (toDelete.length === 0 && needsReview.length === 0) {
    console.log("No duplicates found.\n");
    return;
  }

  if (!confirmed) {
    if (toDelete.length > 0) console.log(`Dry run only — nothing deleted. Re-run with --confirm true to delete the ${toDelete.length} site(s) listed above.\n`);
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const { site } of toDelete) {
    try {
      await siteService.deleteSite(site, site.slug, systemActor);
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error(`  Failed to delete ${site.slug}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`Deleted ${deleted} site(s)${failed > 0 ? `, ${failed} failed` : ""}.\n`);
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) continue;
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function required(options: Record<string, string>, key: string): string {
  const value = options[key];
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}
