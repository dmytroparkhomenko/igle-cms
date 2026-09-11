import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { applyPageSEO, parsePageSEO, stableHash, type SeoPatchInput } from "@igle/html-engine";
import { assertCan, IgleError, resolveInside, type Actor } from "@igle/shared";
import { readPagesMetadata, writePagesMetadata } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import { JsonStateStore } from "./state-store.js";
import type { PageIndexRecord, SiteRecord } from "./types.js";

export class SEOService {
  constructor(
    private readonly stateStore: JsonStateStore,
    private readonly revisionService: RevisionService
  ) {}

  async updateFields(site: SiteRecord, pageId: string, fields: SeoPatchInput, actor: Actor): Promise<{ revisionNumber: number; page: PageIndexRecord }> {
    assertCan(actor, "sites.edit", site.id);
    const page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);

    const filePath = resolveInside(site.repoPath, page.filePath);
    const original = await fs.readFile(filePath, "utf8");
    const parsed = parsePageSEO(original);
    for (const field of Object.keys(fields) as Array<keyof SeoPatchInput>) {
      const parsedField = field === "seoTitle" ? parsed.seoTitle : field === "metaDescription" ? parsed.metaDescription : parsed.h1;
      if (parsedField.state === "ambiguous" || parsedField.readOnly) {
        throw new IgleError("FIELD_READ_ONLY", `${field} is read-only until the source is resolved.`, 409, { field });
      }
    }

    const result = applyPageSEO(original, fields);
    await fs.writeFile(filePath, result.html, "utf8");
    const nextParsed = parsePageSEO(result.html);
    const pagesMetadata = await readPagesMetadata(site.repoPath);
    const metaPage = pagesMetadata.pages.find((item) => item.id === page.id);
    if (metaPage) {
      for (const key of Object.keys(fields)) {
        const value = fieldValue(nextParsed, key);
        metaPage.fieldStates[key as keyof typeof metaPage.fieldStates] = "explicit";
        metaPage.lastWrittenHashes[key] = stableHash(value);
      }
      await writePagesMetadata(site.repoPath, pagesMetadata);
    }

    const revision = await this.revisionService.commitRevision({
      site,
      source: "manual-field-edit",
      title: `Updated SEO fields for ${page.filePath}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });
    const indexed = await this.reindexPage(site, page, revision.id);
    return { revisionNumber: revision.revisionNumber, page: indexed };
  }

  async saveSource(site: SiteRecord, pageId: string, content: string, actor: Actor): Promise<{ revisionNumber: number; page: PageIndexRecord }> {
    assertCan(actor, "sites.code", site.id);
    const page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);

    const filePath = resolveInside(site.repoPath, page.filePath);
    await fs.writeFile(filePath, content, "utf8");
    const parsed = parsePageSEO(content);
    const pagesMetadata = await readPagesMetadata(site.repoPath);
    const metaPage = pagesMetadata.pages.find((item) => item.id === page.id);
    if (metaPage) {
      for (const key of Object.keys(metaPage.fieldStates)) {
        const value = fieldValue(parsed, key);
        const lastWritten = metaPage.lastWrittenHashes[key];
        if (lastWritten && stableHash(value) !== lastWritten) {
          metaPage.fieldStates[key as keyof typeof metaPage.fieldStates] = "manual-source";
        }
        if (parsed[key as keyof typeof parsed] && (parsed[key as keyof typeof parsed] as { state?: string }).state === "ambiguous") {
          metaPage.fieldStates[key as keyof typeof metaPage.fieldStates] = "ambiguous";
        }
      }
      await writePagesMetadata(site.repoPath, pagesMetadata);
    }

    const revision = await this.revisionService.commitRevision({
      site,
      source: "code-editor",
      title: `Saved source for ${page.filePath}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });
    const indexed = await this.reindexPage(site, page, revision.id);
    return { revisionNumber: revision.revisionNumber, page: indexed };
  }

  async reindexPage(site: SiteRecord, page: PageIndexRecord, revisionId?: string): Promise<PageIndexRecord> {
    const content = await fs.readFile(resolveInside(site.repoPath, page.filePath), "utf8");
    const parsed = parsePageSEO(content);
    const next: PageIndexRecord = {
      ...page,
      seoTitle: parsed.seoTitle.value,
      metaDescription: parsed.metaDescription.value,
      h1: parsed.h1.value,
      canonical: parsed.canonical.value,
      robots: parsed.robots.value,
      lang: parsed.lang,
      ogTitle: parsed.ogTitle.value,
      ogDescription: parsed.ogDescription.value,
      fieldStates: {
        ...page.fieldStates,
        seoTitle: parsed.seoTitle.state,
        metaDescription: parsed.metaDescription.state,
        h1: parsed.h1.state,
        canonical: parsed.canonical.state,
        robots: parsed.robots.state,
        ogTitle: parsed.ogTitle.state,
        ogDescription: parsed.ogDescription.state
      },
      h1Count: parsed.h1Count,
      wordCount: parsed.wordCount,
      imagesCount: parsed.imagesCount,
      imagesMissingAlt: parsed.imagesMissingAlt,
      fileHash: createHash("sha256").update(content).digest("hex"),
      auditIssues: parsed.issues,
      lastRevisionId: revisionId ?? page.lastRevisionId
    };
    await this.stateStore.update((state) => {
      const index = state.pages.findIndex((item) => item.id === page.id);
      if (index >= 0) state.pages[index] = next;
    });
    return next;
  }

  private async getPage(siteId: string, pageId: string): Promise<PageIndexRecord | undefined> {
    const state = await this.stateStore.read();
    return state.pages.find((page) => page.siteId === siteId && (page.id === pageId || page.filePath === pageId));
  }
}

function fieldValue(parsed: ReturnType<typeof parsePageSEO>, key: string): string | undefined {
  switch (key) {
    case "seoTitle":
      return parsed.seoTitle.value;
    case "metaDescription":
      return parsed.metaDescription.value;
    case "h1":
      return parsed.h1.value;
    case "canonical":
      return parsed.canonical.value;
    case "robots":
      return parsed.robots.value;
    case "ogTitle":
      return parsed.ogTitle.value;
    case "ogDescription":
      return parsed.ogDescription.value;
    default:
      return undefined;
  }
}
