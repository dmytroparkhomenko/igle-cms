import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parsePageSEO } from "@igle/html-engine";
import { assertCan, effectiveSiteLanguageTag, IgleError, matchesSiteLanguage, resolveInside, type Actor } from "@igle/shared";
import { routeForFile } from "./import-service.js";
import { readPagesMetadata, writePagesMetadata } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import { JsonStateStore, id } from "./state-store.js";
import type { PageIndexRecord, SiteRecord } from "./types.js";

export class PageService {
  constructor(
    private readonly stateStore: JsonStateStore,
    private readonly revisionService: RevisionService
  ) {}

  async duplicate(site: SiteRecord, pageId: string, actor: Actor): Promise<{ revisionNumber: number; page: PageIndexRecord }> {
    assertCan(actor, "sites.edit", site.id);
    const page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);
    if (page.deletedAt) throw new IgleError("PAGE_DELETED", "A page in the trash cannot be duplicated. Restore it first.", 409);

    const html = await fs.readFile(resolveInside(site.repoPath, page.filePath), "utf8");
    const newFilePath = await this.nextAvailablePath(site.repoPath, page.filePath);
    const newAbsolute = resolveInside(site.repoPath, newFilePath);
    await fs.mkdir(path.dirname(newAbsolute), { recursive: true });
    await fs.writeFile(newAbsolute, html, "utf8");

    const parsed = parsePageSEO(html);
    const newPage: PageIndexRecord = {
      ...page,
      id: id("page"),
      filePath: newFilePath,
      route: routeForFile(newFilePath, site.metadata.urlStyle),
      internalName: `${page.internalName} (Copy)`,
      fieldStates: {
        ...page.fieldStates,
        lang:
          parsed.lang === undefined
            ? "absent"
            : matchesSiteLanguage(parsed.lang, effectiveSiteLanguageTag(site.metadata))
              ? "inherited"
              : "explicit"
      },
      fileHash: hash(html),
      lastRevisionId: undefined,
      deletedAt: undefined,
      trashPath: undefined
    };

    const pagesMetadata = await readPagesMetadata(site.repoPath);
    pagesMetadata.pages.push({
      id: newPage.id,
      filePath: newPage.filePath,
      route: newPage.route,
      internalName: newPage.internalName,
      inSitemap: newPage.inSitemap,
      fieldStates: {
        seoTitle: newPage.fieldStates.seoTitle ?? "absent",
        metaDescription: newPage.fieldStates.metaDescription ?? "absent",
        h1: newPage.fieldStates.h1 ?? "absent",
        canonical: newPage.fieldStates.canonical ?? "absent",
        robots: newPage.fieldStates.robots ?? "absent",
        ogTitle: newPage.fieldStates.ogTitle ?? "absent",
        ogDescription: newPage.fieldStates.ogDescription ?? "absent"
      },
      lastWrittenHashes: {}
    });
    await writePagesMetadata(site.repoPath, pagesMetadata);

    await this.stateStore.update((state) => {
      state.pages.push(newPage);
    });

    const revision = await this.revisionService.commitRevision({
      site,
      source: "page-duplicate",
      title: `Duplicated ${page.filePath} to ${newFilePath}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    await this.stateStore.update((state) => {
      const record = state.pages.find((item) => item.id === newPage.id);
      if (record) record.lastRevisionId = revision.id;
    });

    return { revisionNumber: revision.revisionNumber, page: newPage };
  }

  async moveToTrash(site: SiteRecord, pageId: string, actor: Actor): Promise<{ revisionNumber: number }> {
    assertCan(actor, "sites.edit", site.id);
    const page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);
    if (page.deletedAt) throw new IgleError("PAGE_DELETED", "Page is already in the trash.", 409);

    const sourceAbsolute = resolveInside(site.repoPath, page.filePath);
    const trashPath = path.posix.join(".igle", "trash", `${page.id}__${page.filePath.replaceAll("/", "__")}`);
    const trashAbsolute = resolveInside(site.repoPath, trashPath);
    await fs.mkdir(path.dirname(trashAbsolute), { recursive: true });
    await fs.rename(sourceAbsolute, trashAbsolute);

    const deletedAt = new Date().toISOString();
    const pagesMetadata = await readPagesMetadata(site.repoPath);
    const metaPage = pagesMetadata.pages.find((item) => item.id === page.id);
    if (metaPage) {
      metaPage.deletedAt = deletedAt;
      metaPage.trashPath = trashPath;
      metaPage.previousInSitemap = metaPage.inSitemap;
      metaPage.inSitemap = false;
      await writePagesMetadata(site.repoPath, pagesMetadata);
    }

    await this.stateStore.update((state) => {
      const record = state.pages.find((item) => item.id === page.id);
      if (record) {
        record.deletedAt = deletedAt;
        record.trashPath = trashPath;
        record.previousInSitemap = record.inSitemap;
        record.inSitemap = false;
      }
    });

    const revision = await this.revisionService.commitRevision({
      site,
      source: "page-delete",
      title: `Moved ${page.filePath} to trash`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    return { revisionNumber: revision.revisionNumber };
  }

  async restore(site: SiteRecord, pageId: string, actor: Actor): Promise<{ revisionNumber: number; page: PageIndexRecord }> {
    assertCan(actor, "sites.edit", site.id);
    const page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);
    if (!page.deletedAt || !page.trashPath) throw new IgleError("PAGE_NOT_IN_TRASH", "Page is not in the trash.", 409);

    const trashAbsolute = resolveInside(site.repoPath, page.trashPath);
    const targetAbsolute = resolveInside(site.repoPath, page.filePath);
    const alreadyExists = await fs
      .access(targetAbsolute)
      .then(() => true)
      .catch(() => false);
    if (alreadyExists) {
      throw new IgleError("SLUG_TAKEN", "A different file now exists at this page's original path. Rename or remove it first.", 409);
    }
    await fs.mkdir(path.dirname(targetAbsolute), { recursive: true });
    await fs.rename(trashAbsolute, targetAbsolute);

    const restoredInSitemap = page.previousInSitemap ?? true;
    const pagesMetadata = await readPagesMetadata(site.repoPath);
    const metaPage = pagesMetadata.pages.find((item) => item.id === page.id);
    if (metaPage) {
      delete metaPage.deletedAt;
      delete metaPage.trashPath;
      delete metaPage.previousInSitemap;
      metaPage.inSitemap = restoredInSitemap;
      await writePagesMetadata(site.repoPath, pagesMetadata);
    }

    const restoredPage: PageIndexRecord = {
      ...page,
      deletedAt: undefined,
      trashPath: undefined,
      previousInSitemap: undefined,
      inSitemap: restoredInSitemap
    };
    await this.stateStore.update((state) => {
      const record = state.pages.find((item) => item.id === page.id);
      if (record) {
        record.deletedAt = undefined;
        record.trashPath = undefined;
        record.previousInSitemap = undefined;
        record.inSitemap = restoredInSitemap;
      }
    });

    const revision = await this.revisionService.commitRevision({
      site,
      source: "page-restore",
      title: `Restored ${page.filePath} from trash`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    return { revisionNumber: revision.revisionNumber, page: restoredPage };
  }

  async purge(site: SiteRecord, pageId: string, actor: Actor): Promise<{ revisionNumber: number }> {
    assertCan(actor, "sites.delete", site.id);
    const page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);
    if (!page.deletedAt) throw new IgleError("PAGE_NOT_IN_TRASH", "Only trashed pages can be permanently deleted.", 409);

    if (page.trashPath) {
      await fs.rm(resolveInside(site.repoPath, page.trashPath), { force: true });
    }

    const pagesMetadata = await readPagesMetadata(site.repoPath);
    pagesMetadata.pages = pagesMetadata.pages.filter((item) => item.id !== page.id);
    await writePagesMetadata(site.repoPath, pagesMetadata);

    await this.stateStore.update((state) => {
      state.pages = state.pages.filter((item) => item.id !== page.id);
    });

    const revision = await this.revisionService.commitRevision({
      site,
      source: "page-purge",
      title: `Permanently deleted ${page.filePath}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    return { revisionNumber: revision.revisionNumber };
  }

  private async getPage(siteId: string, pageId: string): Promise<PageIndexRecord | undefined> {
    const state = await this.stateStore.read();
    return state.pages.find((item) => item.siteId === siteId && item.id === pageId);
  }

  private async nextAvailablePath(repoPath: string, originalFilePath: string): Promise<string> {
    const ext = path.extname(originalFilePath);
    const dir = path.dirname(originalFilePath);
    const base = path.basename(originalFilePath, ext);
    let attempt = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const suffix = attempt === 1 ? "-copy" : `-copy-${attempt}`;
      const candidateRelative = path.posix.join(dir === "." ? "" : dir, `${base}${suffix}${ext}`);
      const candidateAbsolute = resolveInside(repoPath, candidateRelative);
      const exists = await fs
        .access(candidateAbsolute)
        .then(() => true)
        .catch(() => false);
      if (!exists) return candidateRelative;
      attempt += 1;
    }
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
