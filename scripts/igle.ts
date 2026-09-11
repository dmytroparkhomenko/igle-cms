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
  default:
    console.log(`Igle CMS CLI

Commands:
  setup-admin --email <email> --password <password>
  create-blank-site --name <name> --slug <slug>
  import-directory --site <site id or slug> --source <directory>
  list-sites
`);
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
