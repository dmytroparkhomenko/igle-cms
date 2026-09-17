import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  applyPageSEO,
  applyStructuralPatches,
  parsePageSEO,
  stableHash,
  type ParsedField,
  type SeoPatchInput,
  type StructuralPatch
} from "@igle/html-engine";
import {
  assertCan,
  effectiveSiteLanguageTag,
  IgleError,
  matchesSiteLanguage,
  normalizeSitePath,
  redirectsMetadataSchema,
  resolveInside,
  type Actor,
  type FieldState
} from "@igle/shared";
import { routeForFile } from "./import-service.js";
import { readJson, readPagesMetadata, writeJson, writePagesMetadata } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import { JsonStateStore } from "./state-store.js";
import type { PageIndexRecord, RevisionSource, SiteRecord } from "./types.js";

export interface UpdatePageFieldsInput extends SeoPatchInput {
  inSitemap?: boolean;
}

export interface BulkSeoRow {
  pageId: string;
  seoTitle?: string;
  metaDescription?: string;
  h1?: string;
}

export interface BulkSeoResult {
  revisionNumber: number;
  updatedPageIds: string[];
  skipped: Array<{ pageId: string; reason: string }>;
}

export class SEOService {
  constructor(
    private readonly stateStore: JsonStateStore,
    private readonly revisionService: RevisionService
  ) {}

  async updateFields(site: SiteRecord, pageId: string, fields: UpdatePageFieldsInput, actor: Actor): Promise<{ revisionNumber: number; page: PageIndexRecord }> {
    assertCan(actor, "sites.edit", site.id);
    let page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);

    const { inSitemap, lang, ...htmlFields } = fields;
    if (Object.keys(htmlFields).length > 0) {
      await this.applyHtmlFields(site, page, htmlFields);
    }
    if (inSitemap !== undefined) {
      await this.setInSitemap(site, page.id, inSitemap);
    }
    if (lang !== undefined) {
      // lang uses live inherited/explicit computation (INH-01), not the write-tracked
      // explicit/manual-source model the other fields use, so it bypasses applyHtmlFields:
      // null means "match the site language" (inherited), any other value is an override.
      await this.setPageLanguage(site, page, lang ?? effectiveSiteLanguageTag(site.metadata));
    }

    const revision = await this.revisionService.commitRevision({
      site,
      source: "manual-field-edit",
      title: `Updated SEO fields for ${page.filePath}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    page = (await this.getPage(site.id, pageId)) ?? page;
    const indexed = await this.reindexPage(site, page, revision.id);
    return { revisionNumber: revision.revisionNumber, page: indexed };
  }

  /**
   * Applies edits across many pages as one revision (BULK-03). Fields in "manual-source" or
   * "ambiguous" state are excluded (BULK-04). With fillEmptyOnly, a field only applies when
   * the page's current value is empty — matching the spec's default bulk mode.
   */
  async bulkUpdateFields(
    site: SiteRecord,
    rows: BulkSeoRow[],
    actor: Actor,
    options: { fillEmptyOnly: boolean } = { fillEmptyOnly: true }
  ): Promise<BulkSeoResult> {
    assertCan(actor, "sites.edit", site.id);
    const updatedPageIds: string[] = [];
    const skipped: BulkSeoResult["skipped"] = [];

    for (const row of rows) {
      const page = await this.getPage(site.id, row.pageId);
      if (!page) continue;

      const fields: SeoPatchInput = {};
      for (const key of ["seoTitle", "metaDescription", "h1"] as const) {
        const newValue = row[key];
        if (newValue === undefined) continue;
        const currentValue = page[key] ?? "";
        if (newValue === currentValue) continue;

        const state = page.fieldStates[key];
        if (state === "manual-source" || state === "ambiguous") {
          skipped.push({ pageId: page.id, reason: `${key} is ${state} and was excluded from the bulk update.` });
          continue;
        }
        if (options.fillEmptyOnly && currentValue !== "") continue;
        fields[key] = newValue;
      }

      if (Object.keys(fields).length === 0) continue;

      try {
        await this.applyHtmlFields(site, page, fields);
        updatedPageIds.push(page.id);
      } catch (error) {
        skipped.push({ pageId: page.id, reason: error instanceof Error ? error.message : "Failed to apply." });
      }
    }

    if (updatedPageIds.length === 0) {
      const existing = await this.revisionService.latest(site.id);
      return { revisionNumber: existing?.revisionNumber ?? 0, updatedPageIds, skipped };
    }

    const revision = await this.revisionService.commitRevision({
      site,
      source: "bulk-seo",
      title: `Bulk SEO update: ${updatedPageIds.length} page(s)`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    for (const pageId of updatedPageIds) {
      const page = await this.getPage(site.id, pageId);
      if (page) await this.reindexPage(site, page, revision.id);
    }

    return { revisionNumber: revision.revisionNumber, updatedPageIds, skipped };
  }

  /**
   * Applies visual-editor patches (VIS-04/VIS-06) located by node id, as one revision. Also
   * detects when a patch happened to touch a field the CMS separately tracks (e.g. the H1 or
   * title element) and flips it to Manual Source, the same way a raw source save does — a
   * visual edit bypasses the structured field path just as much as hand-editing the file would.
   */
  async applyVisualEdits(
    site: SiteRecord,
    pageId: string,
    patches: StructuralPatch[],
    actor: Actor,
    source: RevisionSource = "visual-editor"
  ): Promise<{ revisionNumber: number; page: PageIndexRecord }> {
    assertCan(actor, "sites.edit", site.id);
    let page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);
    if (patches.length === 0) {
      const existing = await this.revisionService.latest(site.id);
      return { revisionNumber: existing?.revisionNumber ?? 0, page };
    }

    const filePath = resolveInside(site.repoPath, page.filePath);
    const original = await fs.readFile(filePath, "utf8");
    const result = applyStructuralPatches(original, patches);
    await fs.writeFile(filePath, result.html, "utf8");

    const parsed = parsePageSEO(result.html);
    const editedPageId = page.id;
    const pagesMetadata = await readPagesMetadata(site.repoPath);
    const metaPage = pagesMetadata.pages.find((item) => item.id === editedPageId);
    if (metaPage) {
      for (const key of Object.keys(metaPage.fieldStates)) {
        const value = fieldValue(parsed, key);
        const lastWritten = metaPage.lastWrittenHashes[key];
        if (lastWritten && stableHash(value) !== lastWritten) {
          metaPage.fieldStates[key as keyof typeof metaPage.fieldStates] = "manual-source";
        }
      }
      await writePagesMetadata(site.repoPath, pagesMetadata);
    }

    const revision = await this.revisionService.commitRevision({
      site,
      source,
      title: `Visual edit on ${page.filePath}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    page = (await this.getPage(site.id, pageId)) ?? page;
    const indexed = await this.reindexPage(site, page, revision.id);
    return { revisionNumber: revision.revisionNumber, page: indexed };
  }

  async replaceImage(
    site: SiteRecord,
    pageId: string,
    nodeId: number,
    input: { src: string; alt?: string },
    actor: Actor
  ): Promise<{ revisionNumber: number; page: PageIndexRecord }> {
    const patches: StructuralPatch[] = [{ nodeId, op: "setAttr", attrName: "src", value: input.src }];
    if (input.alt !== undefined) patches.push({ nodeId, op: "setAttr", attrName: "alt", value: input.alt });
    return this.applyVisualEdits(site, pageId, patches, actor, "media");
  }

  /**
   * Renames a page's file (PAGE-04) — moving its slug — and updates its computed route.
   * Optionally adds a 301 redirect from the old URL in the same revision. Does not yet rewrite
   * internal <a href> references elsewhere in the site to the new path (PAGE-04 step 1) —
   * those keep pointing at the old URL unless a redirect is added or they're updated by hand.
   */
  async renamePage(
    site: SiteRecord,
    pageId: string,
    newFilePath: string,
    options: { addRedirect: boolean },
    actor: Actor
  ): Promise<{ revisionNumber: number; page: PageIndexRecord }> {
    assertCan(actor, "sites.edit", site.id);
    let page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);

    let normalizedNew: string;
    try {
      normalizedNew = normalizeSitePath(newFilePath);
    } catch (error) {
      throw new IgleError("INVALID_SLUG", error instanceof Error ? error.message : "Invalid slug.", 400);
    }
    if (!/\.(html|htm)$/i.test(normalizedNew)) {
      throw new IgleError("INVALID_SLUG", "The page path must end in .html.", 400);
    }

    const oldFilePath = page.filePath;
    const oldRoute = page.route;
    if (normalizedNew === oldFilePath) {
      const existing = await this.revisionService.latest(site.id);
      return { revisionNumber: existing?.revisionNumber ?? 0, page };
    }

    const oldAbsolute = resolveInside(site.repoPath, oldFilePath);
    const newAbsolute = resolveInside(site.repoPath, normalizedNew);
    const alreadyExists = await fs
      .access(newAbsolute)
      .then(() => true)
      .catch(() => false);
    if (alreadyExists) throw new IgleError("SLUG_TAKEN", "A file already exists at that path.", 409);

    await fs.mkdir(path.dirname(newAbsolute), { recursive: true });
    await fs.rename(oldAbsolute, newAbsolute);

    const newRoute = routeForFile(normalizedNew, site.metadata.urlStyle);
    const renamedPageId = page.id;
    const pagesMetadata = await readPagesMetadata(site.repoPath);
    const metaPage = pagesMetadata.pages.find((item) => item.id === renamedPageId);
    if (metaPage) {
      metaPage.filePath = normalizedNew;
      metaPage.route = newRoute;
      await writePagesMetadata(site.repoPath, pagesMetadata);
    }

    let redirectAdded = false;
    if (options.addRedirect && oldRoute !== newRoute) {
      const redirectsPath = path.join(site.repoPath, ".igle", "redirects.json");
      const redirectsMetadata = redirectsMetadataSchema.parse(await readJson(redirectsPath));
      const alreadyRedirected = redirectsMetadata.redirects.some((item) => item.from === oldRoute);
      const targetLoops = redirectsMetadata.redirects.some((item) => item.from === newRoute && item.to === oldRoute);
      if (!alreadyRedirected && !targetLoops) {
        redirectsMetadata.redirects.push({ id: `redirect_${randomUUID().replaceAll("-", "")}`, from: oldRoute, to: newRoute, status: "301" });
        await writeJson(redirectsPath, redirectsMetadata);
        redirectAdded = true;
      }
    }

    const revision = await this.revisionService.commitRevision({
      site,
      source: "file-manager",
      title: `Renamed ${oldFilePath} to ${normalizedNew}${redirectAdded ? " (with redirect)" : ""}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    page = { ...page, filePath: normalizedNew, route: newRoute };
    await this.stateStore.update((state) => {
      const record = state.pages.find((item) => item.id === pageId);
      if (record) {
        record.filePath = normalizedNew;
        record.route = newRoute;
      }
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
    const pagesMetadata = await readPagesMetadata(site.repoPath).catch(() => undefined);
    const trackedStates = pagesMetadata?.pages.find((item) => item.id === page.id)?.fieldStates;

    // parsePageSEO only knows structural facts (absent/explicit/ambiguous); it can't know
    // "inherited" or "manual-source" — those come from comparing against what the CMS last
    // wrote, tracked in .igle/pages.json. Prefer that tracked state whenever the field is
    // still structurally present, and only defer to the parser when the structure itself
    // changed (the field disappeared or became ambiguous).
    type ManagedFieldKey = "seoTitle" | "metaDescription" | "h1" | "canonical" | "robots" | "ogTitle" | "ogDescription";
    const resolvedState = (key: ManagedFieldKey, structural: FieldState): FieldState =>
      structural === "explicit" && trackedStates ? (trackedStates[key] ?? structural) : structural;

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
        seoTitle: resolvedState("seoTitle", parsed.seoTitle.state),
        metaDescription: resolvedState("metaDescription", parsed.metaDescription.state),
        h1: resolvedState("h1", parsed.h1.state),
        canonical: resolvedState("canonical", parsed.canonical.state),
        robots: resolvedState("robots", parsed.robots.state),
        ogTitle: resolvedState("ogTitle", parsed.ogTitle.state),
        ogDescription: resolvedState("ogDescription", parsed.ogDescription.state),
        // lang is always live-computed against the site's current language (INH-01) rather
        // than tracked/preserved like the fields above — "inherited" here specifically means
        // "still matches the site default," which can only be judged fresh, not remembered.
        lang: langFieldState(parsed.lang, effectiveSiteLanguageTag(site.metadata))
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

  private async applyHtmlFields(site: SiteRecord, page: PageIndexRecord, fields: SeoPatchInput): Promise<void> {
    const filePath = resolveInside(site.repoPath, page.filePath);
    const original = await fs.readFile(filePath, "utf8");
    const parsed = parsePageSEO(original);
    for (const field of Object.keys(fields) as Array<keyof SeoPatchInput>) {
      const current = parsedField(parsed, field);
      if (current.state === "ambiguous" || current.readOnly) {
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
  }

  private async setInSitemap(site: SiteRecord, pageId: string, inSitemap: boolean): Promise<void> {
    const pagesMetadata = await readPagesMetadata(site.repoPath);
    const metaPage = pagesMetadata.pages.find((item) => item.id === pageId);
    if (metaPage) {
      metaPage.inSitemap = inSitemap;
      await writePagesMetadata(site.repoPath, pagesMetadata);
    }
    await this.stateStore.update((state) => {
      const record = state.pages.find((item) => item.id === pageId);
      if (record) record.inSitemap = inSitemap;
    });
  }

  private async setPageLanguage(site: SiteRecord, page: PageIndexRecord, value: string): Promise<void> {
    const filePath = resolveInside(site.repoPath, page.filePath);
    const original = await fs.readFile(filePath, "utf8");
    const result = applyPageSEO(original, { lang: value });
    await fs.writeFile(filePath, result.html, "utf8");
  }

  private async getPage(siteId: string, pageId: string): Promise<PageIndexRecord | undefined> {
    const state = await this.stateStore.read();
    return state.pages.find((page) => page.siteId === siteId && (page.id === pageId || page.filePath === pageId));
  }
}

function parsedField(parsed: ReturnType<typeof parsePageSEO>, key: keyof SeoPatchInput): ParsedField {
  switch (key) {
    case "seoTitle":
      return parsed.seoTitle;
    case "metaDescription":
      return parsed.metaDescription;
    case "h1":
      return parsed.h1;
    case "canonical":
      return parsed.canonical;
    case "robots":
      return parsed.robots;
    case "ogTitle":
      return parsed.ogTitle;
    case "ogDescription":
      return parsed.ogDescription;
    case "lang":
      // lang is always stripped out before applyHtmlFields sees it (SEOService.updateFields
      // handles it separately via setPageLanguage); this case only exists to satisfy the
      // exhaustiveness check now that SeoPatchInput includes it.
      return { value: parsed.lang, state: parsed.lang === undefined ? "absent" : "explicit", occurrences: parsed.lang === undefined ? 0 : 1 };
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

function langFieldState(pageLang: string | undefined, siteLanguage: string): FieldState {
  if (pageLang === undefined) return "absent";
  return matchesSiteLanguage(pageLang, siteLanguage) ? "inherited" : "explicit";
}
