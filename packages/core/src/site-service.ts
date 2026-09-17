import fs from "node:fs/promises";
import path from "node:path";
import { applyPageSEO, parsePageSEO } from "@igle/html-engine";
import { assertCan, effectiveSiteLanguageTag, IgleError, matchesSiteLanguage, resolveInside, type Actor, type SiteMetadata } from "@igle/shared";
import { ensureIgleMetadata, writeSiteMetadata } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import { JsonStateStore, id } from "./state-store.js";
import type { SiteRecord } from "./types.js";

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
  deploymentTarget?: SiteMetadata["deploymentTarget"];
  serverId?: string;
}

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
const LANGUAGE_PATTERN = /^[a-z]{2}$/i;
const COUNTRY_PATTERN = /^[a-z]{2}$/i;

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
    await ensureIgleMetadata(repoPath, metadata);

    const site: SiteRecord = { id: siteId, slug: input.slug, repoPath, metadata };
    await this.stateStore.update((state) => {
      state.sites.push(site);
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
    });
    return site;
  }

  async updateSettings(site: SiteRecord, input: UpdateSiteSettingsInput, actor: Actor): Promise<{ revisionNumber: number; site: SiteRecord }> {
    assertCan(actor, "sites.edit", site.id);
    const domain = input.domain?.trim();
    if (domain && !DOMAIN_PATTERN.test(domain)) {
      throw new IgleError("INVALID_DOMAIN", "Enter a valid domain, e.g. example.com.", 400, { domain });
    }
    const language = input.language?.trim();
    if (language && !LANGUAGE_PATTERN.test(language)) {
      throw new IgleError("INVALID_LANGUAGE", "Language must be a 2-letter ISO 639-1 code, e.g. en.", 400, { language });
    }
    const country = input.country?.trim();
    if (country && !COUNTRY_PATTERN.test(country)) {
      throw new IgleError("INVALID_COUNTRY", "Country must be a 2-letter ISO 3166-1 code, e.g. US.", 400, { country });
    }

    let nextServerId = site.metadata.serverId;
    if (input.serverId !== undefined) {
      const trimmedServerId = input.serverId.trim();
      if (trimmedServerId === "") {
        nextServerId = undefined;
      } else if (trimmedServerId !== site.metadata.serverId) {
        const state = await this.stateStore.read();
        const server = state.servers.find((item) => item.id === trimmedServerId);
        if (!server) throw new IgleError("SERVER_NOT_FOUND", "That server was not found.", 404);
        if (server.restricted && !actor.canDeployRestricted) {
          throw new IgleError(
            "FORBIDDEN_RESTRICTED_SERVER",
            `"${server.name}" is a restricted server — only administrators granted access can move a site there.`,
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
      domain: domain || undefined,
      urlStyle: input.urlStyle ?? site.metadata.urlStyle,
      wwwMode: input.wwwMode ?? site.metadata.wwwMode,
      https: input.https ?? site.metadata.https,
      language: language ? language.toLowerCase() : site.metadata.language,
      country: country ? country.toUpperCase() : site.metadata.country,
      deploymentTarget: input.deploymentTarget ?? site.metadata.deploymentTarget,
      ...(nextServerId ? { serverId: nextServerId } : {}),
      updatedAt: new Date().toISOString()
    };

    await writeSiteMetadata(site.repoPath, metadata);
    site.metadata = metadata;
    await this.stateStore.update((state) => {
      const existing = state.sites.find((item) => item.id === site.id);
      if (existing) existing.metadata = metadata;
    });

    // INH-01: <html lang> defaults to language, or language-COUNTRY once a GEO is set (e.g.
    // "es"+"MX" -> "es-MX"). A page whose lang still matches the OLD effective value (or has
    // none) was tracking the default and follows either change; a page already overridden is
    // left alone. This fires on a country-only change too, since that changes the effective tag.
    const nextEffectiveLang = effectiveSiteLanguageTag(metadata);
    if (nextEffectiveLang !== previousEffectiveLang) {
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
    });
  }

  async list(actor: Actor): Promise<SiteRecord[]> {
    const state = await this.stateStore.read();
    if (actor.role === "administrator") return state.sites;
    const visible = new Set(actor.siteGrants?.map((grant) => grant.siteId) ?? []);
    return state.sites.filter((site) => visible.has(site.id));
  }

  async get(siteIdOrSlug: string, actor: Actor): Promise<SiteRecord | undefined> {
    const state = await this.stateStore.read();
    const site = state.sites.find((item) => item.id === siteIdOrSlug || item.slug === siteIdOrSlug);
    if (!site) return undefined;
    assertCan(actor, "sites.read", site.id);
    return site;
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
