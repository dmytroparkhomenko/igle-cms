import fs from "node:fs/promises";
import path from "node:path";
import { assertCan, type Actor, type SiteMetadata } from "@igle/shared";
import { ensureIgleMetadata } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import { JsonStateStore, id } from "./state-store.js";
import type { SiteRecord } from "./types.js";

export interface CreateBlankSiteInput {
  name: string;
  slug: string;
  language?: string;
  locale?: string;
}

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
      status: "draft",
      sourceType: "blank",
      seoLimits: { titleMin: 30, titleMax: 60, descriptionMin: 70, descriptionMax: 160 },
      sitemap: { enabled: true },
      robots: { mode: "cms-generated" },
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
