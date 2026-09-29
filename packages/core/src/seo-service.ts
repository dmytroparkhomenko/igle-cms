import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  absolutizeRelativeReferences,
  applyPageSEO,
  applyStructuralPatches,
  extractFirstElementByTag,
  extractPageBodyMiddle,
  findRelativeReferences,
  getNodeAttribute,
  getNodeTagName,
  parsePageSEO,
  replaceElementByTag,
  replaceImageSrcEverywhere,
  replacePageBodyMiddle,
  resolveRelativeReference,
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
import { assertSiteEditable } from "./site-guard.js";
import { withSiteLock } from "./site-lock.js";
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
    assertSiteEditable(site);
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
    assertSiteEditable(site);
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

  /** Current header/footer markup, read from whichever page has one first — used to seed the navigation editor with real content. */
  async getSharedElement(site: SiteRecord, tagName: "header" | "footer", actor: Actor): Promise<string | undefined> {
    assertCan(actor, "sites.read", site.id);
    const pages = (await this.stateStore.read()).pages
      .filter((item) => item.siteId === site.id && !item.deletedAt)
      .sort((a, b) => a.route.localeCompare(b.route));
    for (const page of pages) {
      const html = await fs.readFile(resolveInside(site.repoPath, page.filePath), "utf8").catch(() => undefined);
      if (!html) continue;
      const extracted = extractFirstElementByTag(html, tagName);
      if (extracted) return extracted;
    }
    return undefined;
  }

  /**
   * The visual-editor path into the same "apply everywhere" mechanism as the code-based
   * navigation editor: takes whatever the site's <header>/<footer> currently looks like on ONE
   * page (typically wherever the user just edited it visually and saved) and propagates that
   * exact markup to every other page — so navigation can be edited either visually (on a page,
   * then synced) or as raw code (on the dedicated Navigation screen).
   */
  async syncSharedElementFromPage(
    site: SiteRecord,
    pageId: string,
    tagName: "header" | "footer",
    actor: Actor
  ): Promise<BulkSeoResult> {
    assertCan(actor, "sites.edit", site.id);
    assertSiteEditable(site);
    const page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);
    const html = await fs.readFile(resolveInside(site.repoPath, page.filePath), "utf8");
    const extracted = extractFirstElementByTag(html, tagName);
    if (!extracted) throw new IgleError("ELEMENT_NOT_FOUND", `This page has no <${tagName}> element to sync.`, 404);
    return this.replaceSharedElement(site, tagName, extracted, actor);
  }

  /**
   * Replaces the site's <header> or <footer> on every page that has one, as one revision — the
   * "edit navigation once, apply everywhere" feature. Real imported/uploaded sites duplicate this
   * markup per page rather than sharing a template partial, so "apply everywhere" means finding
   * and replacing the same element on every page's own file, not editing one shared source.
   */
  async replaceSharedElement(
    site: SiteRecord,
    tagName: "header" | "footer",
    newHtml: string,
    actor: Actor
  ): Promise<BulkSeoResult> {
    assertCan(actor, "sites.edit", site.id);
    assertSiteEditable(site);
    const pages = (await this.stateStore.read()).pages.filter((item) => item.siteId === site.id && !item.deletedAt);
    const updatedPageIds: string[] = [];
    const skipped: BulkSeoResult["skipped"] = [];

    for (const page of pages) {
      const filePath = resolveInside(site.repoPath, page.filePath);
      try {
        const original = await fs.readFile(filePath, "utf8");
        const result = replaceElementByTag(original, tagName, newHtml);
        if (!result.found) {
          skipped.push({ pageId: page.id, reason: `No <${tagName}> element found on this page.` });
          continue;
        }
        await fs.writeFile(filePath, result.html, "utf8");
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
      source: "navigation",
      title: `Updated site ${tagName}: ${updatedPageIds.length} page(s)`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    for (const pageId of updatedPageIds) {
      const page = await this.getPage(site.id, pageId);
      if (page) await this.reindexPage(site, page, revision.id);
    }

    return { revisionNumber: revision.revisionNumber, updatedPageIds, skipped };
  }

  /**
   * Sets `<link rel="icon" href="...">` on every page that has zero-or-one already (inserting it
   * into `<head>` where absent, updating it where present), as one revision — the site-wide
   * "change the favicon everywhere" counterpart to replaceSharedElement. A page with more than one
   * `rel="icon"` link (e.g. separate 16x16/32x32 variants) is left alone and reported as skipped,
   * the same conservative "don't guess which one" behavior applyPageSEO already uses for canonical.
   */
  async applyFaviconToAllPages(site: SiteRecord, faviconHref: string, actor: Actor): Promise<BulkSeoResult> {
    assertCan(actor, "sites.edit", site.id);
    assertSiteEditable(site);
    const pages = (await this.stateStore.read()).pages.filter((item) => item.siteId === site.id && !item.deletedAt);
    const updatedPageIds: string[] = [];
    const skipped: BulkSeoResult["skipped"] = [];

    for (const page of pages) {
      const filePath = resolveInside(site.repoPath, page.filePath);
      try {
        const original = await fs.readFile(filePath, "utf8");
        const result = applyPageSEO(original, { favicon: faviconHref });
        if (result.patches.length === 0) continue;
        await fs.writeFile(filePath, result.html, "utf8");
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
      source: "site-settings",
      title: `Updated favicon: ${updatedPageIds.length} page(s)`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    for (const pageId of updatedPageIds) {
      const page = await this.getPage(site.id, pageId);
      if (page) await this.reindexPage(site, page, revision.id);
    }

    return { revisionNumber: revision.revisionNumber, updatedPageIds, skipped };
  }

  /**
   * Rewrites every relative href/src across every page of the site to an absolute root-relative
   * path (see absolutizeRelativeReferences) — the fix for navigation links that work from some
   * pages but break from others depending on how deeply nested the page's own URL is. Also
   * corrects each page's own stored route where it didn't match how the file actually gets served
   * (a "folder/index.html" page historically got a route like "/folder/index" instead of the real
   * "/folder/" — see routeForFile). One combined revision.
   */
  async fixInternalLinks(site: SiteRecord, actor: Actor): Promise<BulkSeoResult> {
    assertCan(actor, "sites.edit", site.id);
    assertSiteEditable(site);
    const allPages = (await this.stateStore.read()).pages.filter((item) => item.siteId === site.id && !item.deletedAt);

    const correctedRoutes = new Map<string, string>();
    for (const page of allPages) {
      correctedRoutes.set(page.id, routeForFile(page.filePath, site.metadata.urlStyle));
    }

    const updatedPageIds: string[] = [];
    const skipped: BulkSeoResult["skipped"] = [];
    const routeChangedIds = new Set<string>();

    for (const page of allPages) {
      const correctPath = correctedRoutes.get(page.id)!;
      const filePath = resolveInside(site.repoPath, page.filePath);
      try {
        const original = await fs.readFile(filePath, "utf8");

        // A relative reference's correct resolution depends on where the author assumed the
        // linking page would live — usually the site root (many exported templates duplicate
        // nav/asset markup across every page assuming a flat, one-level file layout), but
        // sometimes genuinely relative to the page's own nested folder. Neither guess is safe to
        // apply blindly, so each distinct value is resolved both ways and settled by which target
        // actually exists on disk; only switch to the root-relative form when it does and the
        // page-relative one doesn't. Ambiguous or unresolved cases are left exactly as authored.
        const decisions = new Map<string, string>();
        for (const reference of findRelativeReferences(original)) {
          if (decisions.has(reference.value)) continue;
          const pageCandidate = resolveRelativeReference(reference.value, correctPath);
          const rootCandidate = resolveRelativeReference(reference.value, "/");
          let finalValue = pageCandidate;
          if (rootCandidate !== pageCandidate) {
            const [pageExists, rootExists] = await Promise.all([
              referenceTargetExists(site.repoPath, pageCandidate),
              referenceTargetExists(site.repoPath, rootCandidate)
            ]);
            if (rootExists && !pageExists) finalValue = rootCandidate;
          }
          decisions.set(reference.value, finalValue);
        }

        const result = absolutizeRelativeReferences(original, (reference) => decisions.get(reference.value));
        if (result.count > 0) {
          await fs.writeFile(filePath, result.html, "utf8");
          updatedPageIds.push(page.id);
        }
        if (correctPath !== page.route) routeChangedIds.add(page.id);
      } catch (error) {
        skipped.push({ pageId: page.id, reason: error instanceof Error ? error.message : "Failed to process." });
      }
    }

    if (updatedPageIds.length === 0 && routeChangedIds.size === 0) {
      const existing = await this.revisionService.latest(site.id);
      return { revisionNumber: existing?.revisionNumber ?? 0, updatedPageIds, skipped };
    }

    if (routeChangedIds.size > 0) {
      await this.stateStore.update((state) => {
        for (const record of state.pages) {
          if (routeChangedIds.has(record.id)) record.route = correctedRoutes.get(record.id)!;
        }
      });
    }

    const revision = await this.revisionService.commitRevision({
      site,
      source: "site-settings",
      title:
        routeChangedIds.size > 0
          ? `Fixed internal links on ${updatedPageIds.length} page(s), corrected ${routeChangedIds.size} page route(s)`
          : `Fixed internal links on ${updatedPageIds.length} page(s)`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    for (const pageId of updatedPageIds) {
      const page = await this.getPage(site.id, pageId);
      if (page) await this.reindexPage(site, page, revision.id);
    }

    return { revisionNumber: revision.revisionNumber, updatedPageIds, skipped };
  }

  /**
   * Applies visual-editor patches (VIS-04/VIS-06) located by node id, as one revision — the single
   * save point for the whole visual editor session (text, style, link, remove/duplicate, image
   * replace): nothing here is written until the caller has batched up everything the user queued
   * locally and clicked Save. Also detects when a patch happened to touch a field the CMS
   * separately tracks (e.g. the H1 or title element) and flips it to Manual Source, the same way a
   * raw source save does — a visual edit bypasses the structured field path just as much as
   * hand-editing the file would.
   *
   * Any patch that sets an `<img>`'s `src` also propagates to every other place that same old
   * image appears — other occurrences on this same page (e.g. a logo in both header and footer)
   * and every other page in the site — stripping any stale `srcset` there too (a browser prefers
   * `srcset` over `src` whenever both are present, so leaving it behind would make the swap
   * invisible). All of it lands in the one revision this call produces.
   */
  async applyVisualEdits(
    site: SiteRecord,
    pageId: string,
    patches: StructuralPatch[],
    actor: Actor,
    source: RevisionSource = "visual-editor"
  ): Promise<{ revisionNumber: number; page: PageIndexRecord; updatedPageIds: string[] }> {
    assertCan(actor, "sites.edit", site.id);
    assertSiteEditable(site);
    return withSiteLock(site.id, () => this.applyVisualEditsLocked(site, pageId, patches, actor, source));
  }

  /**
   * The actual work, serialized per site by applyVisualEdits — without this, two edits landing
   * close together (e.g. replacing several images in a row) can race: both read the same "before"
   * file, and whichever writes second silently overwrites the first's change, or their concurrent
   * git commits collide. See site-lock.ts.
   */
  private async applyVisualEditsLocked(
    site: SiteRecord,
    pageId: string,
    patches: StructuralPatch[],
    actor: Actor,
    source: RevisionSource
  ): Promise<{ revisionNumber: number; page: PageIndexRecord; updatedPageIds: string[] }> {
    let page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);
    if (patches.length === 0) {
      const existing = await this.revisionService.latest(site.id);
      return { revisionNumber: existing?.revisionNumber ?? 0, page, updatedPageIds: [] };
    }

    const filePath = resolveInside(site.repoPath, page.filePath);
    const original = await fs.readFile(filePath, "utf8");

    const imageSwaps: Array<{ oldSrc: string; newSrc: string }> = [];
    for (const patch of patches) {
      if (patch.op !== "setAttr" || patch.attrName !== "src") continue;
      if (getNodeTagName(original, patch.nodeId) !== "img") continue;
      const oldSrc = getNodeAttribute(original, patch.nodeId, "src");
      const newSrc = patch.value ?? "";
      if (oldSrc && oldSrc !== newSrc) imageSwaps.push({ oldSrc, newSrc });
    }

    let primaryHtml = applyStructuralPatches(original, patches).html;
    for (const swap of imageSwaps) {
      primaryHtml = replaceImageSrcEverywhere(primaryHtml, swap.oldSrc, swap.newSrc).html;
    }
    await fs.writeFile(filePath, primaryHtml, "utf8");

    const parsed = parsePageSEO(primaryHtml);
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

    const updatedPageIds = new Set<string>();
    if (imageSwaps.length > 0) {
      const otherPages = (await this.stateStore.read()).pages.filter(
        (item) => item.siteId === site.id && !item.deletedAt && item.id !== editedPageId
      );
      for (const otherPage of otherPages) {
        const otherFilePath = resolveInside(site.repoPath, otherPage.filePath);
        let otherHtml = await fs.readFile(otherFilePath, "utf8").catch(() => undefined);
        if (otherHtml === undefined) continue;
        let touched = false;
        for (const swap of imageSwaps) {
          const swept = replaceImageSrcEverywhere(otherHtml, swap.oldSrc, swap.newSrc);
          if (swept.count === 0) continue;
          otherHtml = swept.html;
          touched = true;
        }
        if (!touched) continue;
        await fs.writeFile(otherFilePath, otherHtml, "utf8");
        updatedPageIds.add(otherPage.id);
      }
    }

    const revision = await this.revisionService.commitRevision({
      site,
      source,
      title:
        updatedPageIds.size > 0
          ? `Visual edit on ${page.filePath} and ${updatedPageIds.size} other page(s)`
          : `Visual edit on ${page.filePath}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    page = (await this.getPage(site.id, pageId)) ?? page;
    const indexed = await this.reindexPage(site, page, revision.id);
    for (const otherPageId of updatedPageIds) {
      const otherPage = await this.getPage(site.id, otherPageId);
      if (otherPage) await this.reindexPage(site, otherPage, revision.id);
    }

    return { revisionNumber: revision.revisionNumber, page: indexed, updatedPageIds: [...updatedPageIds] };
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
    assertSiteEditable(site);
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
    assertSiteEditable(site);
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

  /** The page's own markup between `</header>` and `<footer>` — what the code editor shows, since the surrounding header/footer are edited once on the shared Header/Footer screen. */
  async getBodyMiddle(site: SiteRecord, pageId: string, actor: Actor): Promise<string> {
    assertCan(actor, "sites.code", site.id);
    const page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);
    const content = await fs.readFile(resolveInside(site.repoPath, page.filePath), "utf8");
    return extractPageBodyMiddle(content).middle;
  }

  /** Splices edited body-middle markup back into the page's current file, leaving its header/footer bytes untouched, then saves it the same way a full source save does. */
  async saveBodyMiddle(site: SiteRecord, pageId: string, middleContent: string, actor: Actor): Promise<{ revisionNumber: number; page: PageIndexRecord }> {
    assertCan(actor, "sites.code", site.id);
    assertSiteEditable(site);
    const page = await this.getPage(site.id, pageId);
    if (!page) throw new IgleError("PAGE_NOT_FOUND", "Page was not found.", 404);
    const current = await fs.readFile(resolveInside(site.repoPath, page.filePath), "utf8");
    const fullContent = replacePageBodyMiddle(current, middleContent);
    return this.saveSource(site, pageId, fullContent, actor);
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
    case "favicon":
      // favicon is only ever set site-wide via SEOService.applyFaviconToAllPages, which calls
      // applyPageSEO directly and never goes through updateFields — this case only exists to
      // satisfy the exhaustiveness check now that SeoPatchInput includes it.
      return { state: "absent", occurrences: 0 };
  }
}

/** Checks whether an absolute root-relative path (as produced by resolveRelativeReference) corresponds to a real file in the site's repo — a directory-style path is checked as its index.html/.htm, an extensionless path is also tried with .html appended and as a folder index. */
async function referenceTargetExists(repoPath: string, absolutePath: string): Promise<boolean> {
  const clean = absolutePath.split("?")[0]!.split("#")[0]!;
  const withoutLeadingSlash = clean.replace(/^\/+/, "");
  const candidates: string[] = [];
  if (withoutLeadingSlash === "" || clean.endsWith("/")) {
    const base = withoutLeadingSlash.replace(/\/+$/, "");
    candidates.push(base ? `${base}/index.html` : "index.html", base ? `${base}/index.htm` : "index.htm");
  } else {
    candidates.push(withoutLeadingSlash);
    if (!/\.[a-z0-9]+$/i.test(withoutLeadingSlash)) {
      candidates.push(`${withoutLeadingSlash}.html`, `${withoutLeadingSlash}/index.html`);
    }
  }

  for (const candidate of candidates) {
    try {
      await fs.access(resolveInside(repoPath, candidate));
      return true;
    } catch {
      // try the next candidate
    }
  }
  return false;
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
