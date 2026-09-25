import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { applyPageSEO, parsePageSEO } from "@igle/html-engine";
import { assertCan, effectiveSiteLanguageTag, IgleError, matchesSiteLanguage, resolveInside, type Actor, type SiteMetadata } from "@igle/shared";
import { ensureIgleMetadata, writeSiteMetadata } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import { assertSiteEditable } from "./site-guard.js";
import { JsonStateStore, id } from "./state-store.js";
import type { PageIndexRecord, SiteRecord } from "./types.js";

export interface CreateBlankSiteInput {
  name: string;
  slug: string;
  language?: string;
  locale?: string;
}

export interface UpdateSiteSettingsInput {
  name?: string;
  domain?: string;
  urlStyle?: SiteMetadata["urlStyle"];
  wwwMode?: SiteMetadata["wwwMode"];
  https?: boolean;
  language?: string;
  country?: string;
  category?: SiteMetadata["category"];
  deploymentTarget?: SiteMetadata["deploymentTarget"];
  serverId?: string;
  platform?: SiteMetadata["platform"] | undefined;
  contentLocked?: boolean | undefined;
  contentLockReason?: string | undefined;
  /** Who's setting contentLocked — "auto" (aaPanel detection/re-sync) or "manual" (an admin's explicit choice in Site Settings). Required whenever contentLocked is set, since it decides whether a future re-sync is allowed to touch this site's lock state again. */
  contentLockSource?: SiteMetadata["contentLockSource"] | undefined;
  /** Site-wide canonical target for the domain-gluing strategy — see siteMetadataSchema. Pass an empty string to clear it. */
  canonicalDomain?: string | undefined;
  /** Explicit hreflang alternates for the domain-gluing strategy — replaces the whole list. */
  hreflangTargets?: SiteMetadata["hreflangTargets"] | undefined;
}

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
const LANGUAGE_PATTERN = /^[a-z]{2}$/i;
const COUNTRY_PATTERN = /^[a-z]{2}$/i;
const HREFLANG_PATTERN = /^([a-z]{2}(-[A-Za-z0-9]{2,8})?|x-default)$/i;

export class SiteService {
  constructor(
    private readonly dataDir: string,
    private readonly stateStore: JsonStateStore,
    private readonly revisionService: RevisionService
  ) {}

  async createBlankSite(input: CreateBlankSiteInput, actor: Actor): Promise<SiteRecord> {
    assertCan(actor, "sites.create");
    const now = new Date().toISOString();
    const siteId = id("site");
    const repoPath = path.join(this.dataDir, "sites", siteId, "repo");
    const metadata: SiteMetadata = {
      id: siteId,
      name: input.name,
      slug: input.slug,
      alternateDomains: [],
      language: input.language ?? "en",
      locale: input.locale ?? "en-US",
      urlStyle: "clean",
      wwwMode: "non-www",
      https: true,
      deploymentTarget: "local",
      status: "draft",
      sourceType: "blank",
      starred: false,
      category: "affiliate",
      platform: "static",
      contentLocked: false,
      hreflangTargets: [],
      seoLimits: { titleMin: 30, titleMax: 60, descriptionMin: 70, descriptionMax: 160 },
      sitemap: { enabled: true },
      robots: { mode: "cms-generated" },
      metaRobots: "index",
      createdAt: now,
      updatedAt: now
    };

    await this.revisionService.initializeRepository(repoPath);
    await fs.writeFile(
      path.join(repoPath, "index.html"),
      `<!doctype html>
<html lang="${metadata.locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(metadata.name)}</title>
    <meta name="description" content="">
  </head>
  <body>
    <main>
      <h1>${escapeHtml(metadata.name)}</h1>
    </main>
  </body>
</html>
`,
      "utf8"
    );

    const homepageHtml = await fs.readFile(path.join(repoPath, "index.html"), "utf8");
    const parsed = parsePageSEO(homepageHtml);
    const homepage: PageIndexRecord = {
      id: id("page"),
      siteId,
      filePath: "index.html",
      route: "/",
      internalName: "Home",
      seoTitle: parsed.seoTitle.value,
      metaDescription: parsed.metaDescription.value,
      h1: parsed.h1.value,
      canonical: parsed.canonical.value,
      robots: parsed.robots.value,
      lang: parsed.lang,
      ogTitle: parsed.ogTitle.value,
      ogDescription: parsed.ogDescription.value,
      fieldStates: {
        seoTitle: parsed.seoTitle.state,
        metaDescription: parsed.metaDescription.state,
        h1: parsed.h1.state,
        canonical: parsed.canonical.state,
        robots: parsed.robots.state,
        ogTitle: parsed.ogTitle.state,
        ogDescription: parsed.ogDescription.state,
        lang: "inherited"
      },
      h1Count: parsed.h1Count,
      wordCount: parsed.wordCount,
      imagesCount: parsed.imagesCount,
      imagesMissingAlt: parsed.imagesMissingAlt,
      inSitemap: true,
      fileHash: hash(homepageHtml),
      auditIssues: parsed.issues
    };

    await ensureIgleMetadata(repoPath, metadata, {
      pages: [
        {
          id: homepage.id,
          filePath: homepage.filePath,
          route: homepage.route,
          internalName: homepage.internalName,
          inSitemap: homepage.inSitemap,
          fieldStates: {
            seoTitle: homepage.fieldStates.seoTitle ?? "absent",
            metaDescription: homepage.fieldStates.metaDescription ?? "absent",
            h1: homepage.fieldStates.h1 ?? "absent",
            canonical: homepage.fieldStates.canonical ?? "absent",
            robots: homepage.fieldStates.robots ?? "absent",
            ogTitle: homepage.fieldStates.ogTitle ?? "absent",
            ogDescription: homepage.fieldStates.ogDescription ?? "absent"
          },
          lastWrittenHashes: {}
        }
      ]
    });

    const site: SiteRecord = { id: siteId, slug: input.slug, repoPath, metadata };
    await this.stateStore.update((state) => {
      state.sites.push(site);
      state.pages.push(homepage);
    });
    const revision = await this.revisionService.commitRevision({
      site,
      source: "system",
      title: "Created blank site",
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    site.headRevisionId = revision.id;
    await this.stateStore.update((state) => {
      const existing = state.sites.find((item) => item.id === site.id);
      if (existing) existing.headRevisionId = revision.id;
      const page = state.pages.find((item) => item.id === homepage.id);
      if (page) page.lastRevisionId = revision.id;
    });
    return site;
  }

  async updateSettings(site: SiteRecord, input: UpdateSiteSettingsInput, actor: Actor): Promise<{ revisionNumber: number; site: SiteRecord }> {
    assertCan(actor, "sites.edit", site.id);
    const domain = input.domain?.trim();
    if (domain && !DOMAIN_PATTERN.test(domain)) {
      throw new IgleError("INVALID_DOMAIN", "Enter a valid domain, e.g. example.com.", 400, { domain });
    }
    // Captured now, before `site.metadata` is reassigned further down — the atomic re-check
    // inside the stateStore.update() mutator below needs to know whether the domain is actually
    // changing, and by the time that mutator runs, `site.metadata.domain` no longer reflects the
    // original value to compare against.
    const domainChanged = Boolean(domain && domain !== site.metadata.domain);
    if (domainChanged) {
      const state = await this.stateStore.read();
      const conflict = state.sites.find((item) => item.id !== site.id && item.metadata.domain === domain);
      if (conflict) {
        throw new IgleError("DOMAIN_IN_USE", `"${domain}" is already assigned to "${conflict.metadata.name}".`, 409, { domain });
      }
    }
    const language = input.language?.trim();
    if (language && !LANGUAGE_PATTERN.test(language)) {
      throw new IgleError("INVALID_LANGUAGE", "Language must be a 2-letter ISO 639-1 code, e.g. en.", 400, { language });
    }
    const country = input.country?.trim();
    if (country && !COUNTRY_PATTERN.test(country)) {
      throw new IgleError("INVALID_COUNTRY", "Country must be a 2-letter ISO 3166-1 code, e.g. US.", 400, { country });
    }
    if (input.hreflangTargets) {
      for (const target of input.hreflangTargets) {
        if (!HREFLANG_PATTERN.test(target.lang.trim())) {
          throw new IgleError("INVALID_HREFLANG", `"${target.lang}" isn't a valid hreflang tag — use a language code like "en" or "es-MX", or "x-default".`, 400, { lang: target.lang });
        }
        if (!target.domain.trim()) {
          throw new IgleError("INVALID_HREFLANG", "Every hreflang target needs a domain.", 400);
        }
      }
    }
    // Locking is a safety mechanism, not an ordinary content setting — an editor who could
    // unlock a dynamic (WordPress/MODX) site could then edit and deploy it, which is exactly
    // what the lock exists to prevent. Only an admin can change it either direction.
    if ((input.contentLocked !== undefined || input.platform !== undefined) && actor.role !== "administrator") {
      throw new IgleError("FORBIDDEN", "Only administrators can change a site's content lock.", 403);
    }

    // Settle the effective category before the server check below — a request can change both
    // in the same submission, and the restricted-access gate is an affiliate-only concept.
    const effectiveCategory = input.category ?? site.metadata.category;

    let nextServerId = site.metadata.serverId;
    if (input.serverId !== undefined) {
      const trimmedServerId = input.serverId.trim();
      if (trimmedServerId === "") {
        nextServerId = undefined;
      } else if (trimmedServerId !== site.metadata.serverId) {
        const state = await this.stateStore.read();
        const server = state.servers.find((item) => item.id === trimmedServerId);
        if (!server) throw new IgleError("SERVER_NOT_FOUND", "That server was not found.", 404);
        if (server.restricted && actor.role !== "administrator" && effectiveCategory !== "pbn") {
          throw new IgleError(
            "FORBIDDEN_RESTRICTED_SERVER",
            `"${server.name}" is a restricted server — only administrators can move a site there.`,
            403
          );
        }
        nextServerId = trimmedServerId;
      }
    }

    const previousEffectiveLang = effectiveSiteLanguageTag(site.metadata);

    const { serverId: _droppedServerId, ...metadataWithoutServerId } = site.metadata;
    const metadata: SiteMetadata = {
      ...metadataWithoutServerId,
      name: input.name?.trim() || site.metadata.name,
      // Only touch domain when the caller actually sent one (even an explicit empty string, to
      // clear it) — `domain: domain || undefined` unconditionally wiped it on every call that
      // didn't happen to include it, which is most of them (the main Site Settings form has no
      // domain field at all; a domain is normally assigned separately via DomainService). This
      // was live-reproduced twice: a routine settings save and this session's own reclassify
      // sync both erased a real site's already-assigned domain.
      domain: input.domain !== undefined ? domain || undefined : site.metadata.domain,
      urlStyle: input.urlStyle ?? site.metadata.urlStyle,
      wwwMode: input.wwwMode ?? site.metadata.wwwMode,
      https: input.https ?? site.metadata.https,
      language: language ? language.toLowerCase() : site.metadata.language,
      country: country ? country.toUpperCase() : site.metadata.country,
      category: effectiveCategory,
      deploymentTarget: input.deploymentTarget ?? site.metadata.deploymentTarget,
      ...(nextServerId ? { serverId: nextServerId } : {}),
      platform: input.platform ?? site.metadata.platform,
      contentLocked: input.contentLocked ?? site.metadata.contentLocked,
      contentLockReason: input.contentLockReason ?? site.metadata.contentLockReason,
      contentLockSource: input.contentLockSource ?? site.metadata.contentLockSource,
      canonicalDomain: input.canonicalDomain !== undefined ? input.canonicalDomain.trim() || undefined : site.metadata.canonicalDomain,
      hreflangTargets: input.hreflangTargets ?? site.metadata.hreflangTargets,
      updatedAt: new Date().toISOString()
    };

    await writeSiteMetadata(site.repoPath, metadata);
    site.metadata = metadata;
    await this.stateStore.update((state) => {
      // Re-checked here, atomically, even though the same conflict was already checked above —
      // that earlier check reads state unlocked, and everything between it and this point (a
      // file write, sometimes a server lookup) is an async window another concurrent call can
      // land in. Confirmed as a real, not just theoretical, race: two sites ended up holding the
      // identical domain in production after two aaPanel imports of the same server ran at once,
      // each passing the early check before the other's write had landed. This inner check is
      // what actually prevents state.sites (the source of truth everywhere else in the app) from
      // ever holding two sites with the same domain. If it does throw here, `metadata` was
      // already written to this site's own repo and onto the in-memory `site` object above —
      // that's a narrow, hard-to-fully-close residual gap (fixing it means reordering the file
      // write after the state check, a bigger change than this bug warrants), but it self-heals
      // on the caller's very next successful settings save, and it's now rare in practice: the
      // one confirmed real-world trigger (concurrent aaPanel import runs racing on one server) is
      // fixed at its source in RemoteSiteImportService.
      if (domainChanged) {
        const conflict = state.sites.find((item) => item.id !== site.id && item.metadata.domain === domain);
        if (conflict) {
          throw new IgleError("DOMAIN_IN_USE", `"${domain}" is already assigned to "${conflict.metadata.name}".`, 409, { domain });
        }
      }
      const existing = state.sites.find((item) => item.id === site.id);
      if (existing) existing.metadata = metadata;
    });

    // INH-01: <html lang> defaults to language, or language-COUNTRY once a GEO is set (e.g.
    // "es"+"MX" -> "es-MX"). A page whose lang still matches the OLD effective value (or has
    // none) was tracking the default and follows either change; a page already overridden is
    // left alone. This fires on a country-only change too, since that changes the effective tag.
    // updateSettings itself must stay open on a locked site — it's the only way to unlock one —
    // but the language cascade below rewrites every page's HTML, which is exactly the kind of
    // content mutation locking exists to prevent.
    const nextEffectiveLang = effectiveSiteLanguageTag(metadata);
    if (nextEffectiveLang !== previousEffectiveLang && !metadata.contentLocked) {
      await this.cascadeLanguageToPages(site, previousEffectiveLang, nextEffectiveLang);
    }

    const revision = await this.revisionService.commitRevision({
      site,
      source: "site-settings",
      title: "Updated site settings",
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    site.headRevisionId = revision.id;
    await this.stateStore.update((state) => {
      const existing = state.sites.find((item) => item.id === site.id);
      if (existing) existing.headRevisionId = revision.id;
    });

    return { revisionNumber: revision.revisionNumber, site };
  }

  private async cascadeLanguageToPages(site: SiteRecord, previousLanguage: string, nextLanguage: string): Promise<void> {
    const state = await this.stateStore.read();
    const pages = state.pages.filter((page) => page.siteId === site.id);
    const updatedPageIds: string[] = [];

    for (const page of pages) {
      const filePath = resolveInside(site.repoPath, page.filePath);
      try {
        const original = await fs.readFile(filePath, "utf8");
        const parsed = parsePageSEO(original);
        const tracksDefault = parsed.lang === undefined || matchesSiteLanguage(parsed.lang, previousLanguage);
        if (!tracksDefault) continue; // explicitly overridden on this page — leave it alone
        const result = applyPageSEO(original, { lang: nextLanguage });
        await fs.writeFile(filePath, result.html, "utf8");
        updatedPageIds.push(page.id);
      } catch {
        // best-effort: a page that can't be read/patched is skipped rather than failing the whole settings save
      }
    }

    if (updatedPageIds.length > 0) {
      await this.stateStore.update((current) => {
        for (const record of current.pages) {
          if (updatedPageIds.includes(record.id)) {
            record.lang = nextLanguage;
            record.fieldStates.lang = "inherited";
          }
        }
      });
    }
  }

  /**
   * The explicit, user-triggered counterpart to the soft cascade above: rewrites <html lang> on
   * EVERY page to the site's current effective language, including pages that already have their
   * own explicit override — those become "inherited" again, tracking the site default going
   * forward. Uses whatever is already saved in site settings, not any unsaved form input.
   */
  async reapplyLanguageToAllPages(site: SiteRecord, actor: Actor): Promise<{ revisionNumber: number; updatedPageIds: string[] }> {
    assertCan(actor, "sites.edit", site.id);
    assertSiteEditable(site);
    const effectiveLang = effectiveSiteLanguageTag(site.metadata);
    const state = await this.stateStore.read();
    const pages = state.pages.filter((page) => page.siteId === site.id && !page.deletedAt);
    const updatedPageIds: string[] = [];

    for (const page of pages) {
      const filePath = resolveInside(site.repoPath, page.filePath);
      try {
        const original = await fs.readFile(filePath, "utf8");
        const result = applyPageSEO(original, { lang: effectiveLang });
        await fs.writeFile(filePath, result.html, "utf8");
        updatedPageIds.push(page.id);
      } catch {
        // best-effort: a page that can't be read/patched is skipped rather than failing the whole run
      }
    }

    if (updatedPageIds.length === 0) {
      const existing = await this.revisionService.latest(site.id);
      return { revisionNumber: existing?.revisionNumber ?? 0, updatedPageIds };
    }

    await this.stateStore.update((current) => {
      for (const record of current.pages) {
        if (updatedPageIds.includes(record.id)) {
          record.lang = effectiveLang;
          record.fieldStates.lang = "inherited";
        }
      }
    });

    const revision = await this.revisionService.commitRevision({
      site,
      source: "site-settings",
      title: `Rewrote <html lang> to "${effectiveLang}" on ${updatedPageIds.length} page(s)`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    site.headRevisionId = revision.id;
    await this.stateStore.update((state) => {
      const existing = state.sites.find((item) => item.id === site.id);
      if (existing) existing.headRevisionId = revision.id;
    });

    return { revisionNumber: revision.revisionNumber, updatedPageIds };
  }

  async updateSitemapAndRobots(
    site: SiteRecord,
    input: {
      sitemapEnabled: boolean;
      robotsMode: "cms-generated" | "manual";
      robotsContent?: string;
      metaRobots?: "index" | "noindex";
    },
    actor: Actor
  ): Promise<{ revisionNumber: number }> {
    assertCan(actor, "sites.edit", site.id);
    assertSiteEditable(site);

    const robots: SiteMetadata["robots"] =
      input.robotsMode === "manual" ? { mode: "manual", content: input.robotsContent ?? "" } : { mode: "cms-generated" };
    const metadata: SiteMetadata = {
      ...site.metadata,
      sitemap: { ...site.metadata.sitemap, enabled: input.sitemapEnabled },
      robots,
      metaRobots: input.metaRobots ?? site.metadata.metaRobots,
      updatedAt: new Date().toISOString()
    };

    await writeSiteMetadata(site.repoPath, metadata);
    site.metadata = metadata;
    await this.stateStore.update((state) => {
      const existing = state.sites.find((item) => item.id === site.id);
      if (existing) existing.metadata = metadata;
    });

    if (input.robotsMode === "manual") {
      await fs.writeFile(path.join(site.repoPath, "robots.txt"), input.robotsContent ?? "", "utf8");
    }

    const revision = await this.revisionService.commitRevision({
      site,
      source: "site-settings",
      title: "Updated sitemap and robots settings",
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    site.headRevisionId = revision.id;
    await this.stateStore.update((state) => {
      const existing = state.sites.find((item) => item.id === site.id);
      if (existing) existing.headRevisionId = revision.id;
    });

    return { revisionNumber: revision.revisionNumber };
  }

  /**
   * Permanently deletes a site's files and history from disk (BAK-05). The caller must supply
   * the site's exact slug as a typed confirmation — enforced here, not just in the UI, so a
   * bare POST without the confirmation text can never trigger a real deletion.
   */
  async deleteSite(site: SiteRecord, confirmSlug: string, actor: Actor): Promise<void> {
    assertCan(actor, "sites.delete");
    if (confirmSlug !== site.slug) {
      throw new IgleError("CONFIRMATION_MISMATCH", "Typed slug did not match. Nothing was deleted.", 400);
    }

    await fs.rm(path.dirname(site.repoPath), { recursive: true, force: true });
    await fs.rm(path.join(this.dataDir, "releases", site.slug), { recursive: true, force: true });
    await this.stateStore.update((state) => {
      state.sites = state.sites.filter((item) => item.id !== site.id);
      state.pages = state.pages.filter((item) => item.siteId !== site.id);
      state.revisions = state.revisions.filter((item) => item.siteId !== site.id);
      state.drafts = state.drafts.filter((item) => item.siteId !== site.id);
      state.deployments = state.deployments.filter((item) => item.siteId !== site.id);
      // Deleting one half of a mirror pair leaves the other pointing at a site that's gone.
      for (const other of state.sites) {
        if (other.metadata.mirrorOfSiteId === site.id) other.metadata.mirrorOfSiteId = undefined;
      }
    });
  }

  /** Every site — editors see the same full list as administrators (see permissions.ts for why there's no per-site filtering). */
  async list(_actor: Actor): Promise<SiteRecord[]> {
    const state = await this.stateStore.read();
    return state.sites;
  }

  /** Pins/unpins a site to the top of the Sites list — a pure organizational flag, not content, so it's not a revision. */
  async setStarred(site: SiteRecord, starred: boolean, actor: Actor): Promise<void> {
    assertCan(actor, "sites.edit", site.id);
    await this.stateStore.update((state) => {
      const record = state.sites.find((item) => item.id === site.id);
      if (record) record.metadata.starred = starred;
    });
  }

  async get(siteIdOrSlug: string, actor: Actor): Promise<SiteRecord | undefined> {
    const state = await this.stateStore.read();
    const site = state.sites.find((item) => item.id === siteIdOrSlug || item.slug === siteIdOrSlug);
    if (!site) return undefined;
    assertCan(actor, "sites.read", site.id);
    return site;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
