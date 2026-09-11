import fs from "node:fs/promises";
import path from "node:path";
import { emptyProjectMetadata, validatePagesMetadata, validateSiteMetadata, type PagesMetadata, type SiteMetadata } from "@igle/shared";

export async function ensureIgleMetadata(repoPath: string, site: SiteMetadata, pages: PagesMetadata = emptyProjectMetadata.pages): Promise<void> {
  const igleDir = path.join(repoPath, ".igle");
  await fs.mkdir(path.join(igleDir, "integrations"), { recursive: true });
  await fs.mkdir(path.join(igleDir, "content-map"), { recursive: true });
  await writeJson(path.join(igleDir, "site.json"), validateSiteMetadata(site));
  await writeJson(path.join(igleDir, "pages.json"), validatePagesMetadata(pages));
  await writeJson(path.join(igleDir, "redirects.json"), emptyProjectMetadata.redirects);
  await writeJson(path.join(igleDir, "scripts.json"), emptyProjectMetadata.scripts);
  await writeJson(path.join(igleDir, "verifications.json"), emptyProjectMetadata.verifications);
  await writeJson(path.join(igleDir, "variables.json"), emptyProjectMetadata.variables);
}

export async function readSiteMetadata(repoPath: string): Promise<SiteMetadata> {
  return validateSiteMetadata(await readJson(path.join(repoPath, ".igle", "site.json")));
}

export async function writeSiteMetadata(repoPath: string, site: SiteMetadata): Promise<void> {
  await writeJson(path.join(repoPath, ".igle", "site.json"), validateSiteMetadata(site));
}

export async function readPagesMetadata(repoPath: string): Promise<PagesMetadata> {
  return validatePagesMetadata(await readJson(path.join(repoPath, ".igle", "pages.json")));
}

export async function writePagesMetadata(repoPath: string, pages: PagesMetadata): Promise<void> {
  await writeJson(path.join(repoPath, ".igle", "pages.json"), validatePagesMetadata(pages));
}

export async function readJson(filePath: string): Promise<unknown> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
