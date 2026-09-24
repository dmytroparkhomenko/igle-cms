import { assertCan, IgleError, type Actor } from "@igle/shared";
import { writeSiteMetadata } from "./metadata-store.js";
import { ImportService } from "./import-service.js";
import { RevisionService } from "./revision-service.js";
import { assertSiteEditable } from "./site-guard.js";
import { JsonStateStore } from "./state-store.js";
import type { SiteRecord } from "./types.js";

/**
 * A mirror pair is a full copy of one site's content living under a second site record, so the
 * pair can have independent domains, canonical URLs (already a per-page field) and hreflang
 * (see DeployService/@igle/build) while staying otherwise identical. The relationship is stored
 * on only one side — `mirrorOfSiteId` on the "mirror" points at the "source" — so at most one
 * pair can exist per site; that keeps the deploy-cascade and hreflang lookups in DeployService
 * unambiguous (no chains, no cycles).
 */
export class MirrorService {
  constructor(
    private readonly stateStore: JsonStateStore,
    private readonly importService: ImportService,
    private readonly revisionService: RevisionService
  ) {}

  /** The other site in this site's mirror pair, if any — checked in both directions since the pairing is stored on only one side. */
  async findPartner(site: SiteRecord): Promise<SiteRecord | undefined> {
    const state = await this.stateStore.read();
    if (site.metadata.mirrorOfSiteId) {
      return state.sites.find((item) => item.id === site.metadata.mirrorOfSiteId);
    }
    return state.sites.find((item) => item.metadata.mirrorOfSiteId === site.id);
  }

  /** Full-copies `sourceSiteId`'s current content into `site`, then links the two as a mirror pair. */
  async connect(site: SiteRecord, sourceSiteId: string, actor: Actor): Promise<{ revisionNumber: number; copiedPages: number }> {
    assertCan(actor, "sites.edit", site.id);
    assertSiteEditable(site);
    if (sourceSiteId === site.id) {
      throw new IgleError("INVALID_MIRROR", "A site can't mirror itself.", 400);
    }

    const state = await this.stateStore.read();
    const source = state.sites.find((item) => item.id === sourceSiteId);
    if (!source) throw new IgleError("SITE_NOT_FOUND", "That source site was not found.", 404);

    const existingPartner = await this.findPartner(site);
    if (existingPartner) {
      throw new IgleError(
        "ALREADY_MIRRORED",
        `"${site.metadata.name}" is already mirrored with "${existingPartner.metadata.name}" — disconnect that pairing first.`,
        400
      );
    }
    const sourcePartner = await this.findPartner(source);
    if (sourcePartner) {
      throw new IgleError(
        "SOURCE_ALREADY_MIRRORED",
        `"${source.metadata.name}" is already mirrored with "${sourcePartner.metadata.name}" — a site can only be in one mirror pair.`,
        400
      );
    }

    const localization = { language: site.metadata.language, country: site.metadata.country, locale: site.metadata.locale };
    const { report } = await this.importService.importDirectory(site, source.repoPath, actor);

    // importDirectory detects <html lang> from the copied content and resets language/country/
    // locale to match it — undoing that here is what makes them independently settable per side,
    // regardless of whether they were set before or after connecting.
    const metadata = {
      ...site.metadata,
      ...localization,
      mirrorOfSiteId: source.id,
      duplicatedFromSiteId: source.id,
      sourceType: "duplicate" as const
    };
    await writeSiteMetadata(site.repoPath, metadata);
    site.metadata = metadata;
    await this.stateStore.update((next) => {
      const record = next.sites.find((item) => item.id === site.id);
      if (record) record.metadata = metadata;
    });

    const revision = await this.commitFollowUp(site, `Connected as mirror of "${source.metadata.name}"`, actor);
    return { revisionNumber: revision.revisionNumber, copiedPages: report.pagesFound };
  }

  /** Re-runs the full copy from the paired source into this site — only callable from the mirror side. */
  async resync(site: SiteRecord, actor: Actor): Promise<{ revisionNumber: number; copiedPages: number }> {
    assertCan(actor, "sites.edit", site.id);
    assertSiteEditable(site);
    if (!site.metadata.mirrorOfSiteId) {
      throw new IgleError("NOT_A_MIRROR", "Run re-sync from the mirror site, not the source.", 400);
    }
    const state = await this.stateStore.read();
    const source = state.sites.find((item) => item.id === site.metadata.mirrorOfSiteId);
    if (!source) throw new IgleError("SITE_NOT_FOUND", "The paired source site no longer exists.", 404);

    const localization = { language: site.metadata.language, country: site.metadata.country, locale: site.metadata.locale };
    const { report } = await this.importService.importDirectory(site, source.repoPath, actor);
    const metadata = { ...site.metadata, ...localization };
    await writeSiteMetadata(site.repoPath, metadata);
    site.metadata = metadata;
    await this.stateStore.update((next) => {
      const record = next.sites.find((item) => item.id === site.id);
      if (record) record.metadata = metadata;
    });

    const revision = await this.commitFollowUp(site, `Re-synced from mirror source "${source.metadata.name}"`, actor);
    return { revisionNumber: revision.revisionNumber, copiedPages: report.pagesFound };
  }

  private async commitFollowUp(site: SiteRecord, title: string, actor: Actor) {
    const revision = await this.revisionService.commitRevision({
      site,
      source: "duplicate",
      title,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });
    site.headRevisionId = revision.id;
    await this.stateStore.update((next) => {
      const record = next.sites.find((item) => item.id === site.id);
      if (record) record.headRevisionId = revision.id;
    });
    return revision;
  }

  /** Unlinks a mirror pair — content on both sites is left as-is. */
  async disconnect(site: SiteRecord, actor: Actor): Promise<void> {
    assertCan(actor, "sites.edit", site.id);
    const holderId = site.metadata.mirrorOfSiteId ? site.id : (await this.findPartner(site))?.id;
    if (!holderId) throw new IgleError("NOT_MIRRORED", "This site isn't part of a mirror pair.", 400);

    const state = await this.stateStore.read();
    const holder = state.sites.find((item) => item.id === holderId);
    if (!holder) return;
    const metadata = { ...holder.metadata, mirrorOfSiteId: undefined };
    await writeSiteMetadata(holder.repoPath, metadata);
    await this.stateStore.update((next) => {
      const record = next.sites.find((item) => item.id === holderId);
      if (record) record.metadata.mirrorOfSiteId = undefined;
    });
  }
}
