import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import type { ReactNode } from "react";
import { PreviewImage } from "../PreviewImage";
import { PreviewLink } from "../PreviewLink";
import { resolveAssetRef, type AssetRef } from "../../lib/asset-ref";
import { domainStatusColor, domainStatusLabel } from "../../lib/domain-status";
import { extractFaviconHref } from "../../lib/favicon";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";
import { DeployButton } from "./[siteId]/DeployButton";
import type { CoreState, SiteRecord } from "../../../../packages/core/src/types";

export default async function SitesPage({
  searchParams
}: {
  searchParams: Promise<{ imported?: string; importError?: string; deleted?: string }>;
}) {
  const actor = await requireActorOrRedirect();
  const sites = await runtime.siteService.list(actor);
  const state = await runtime.stateStore.read();
  const { imported, importError, deleted } = await searchParams;
  const previewOrigin = process.env.PREVIEW_ORIGIN ?? "http://localhost:3001";

  const favicons = new Map(
    await Promise.all(
      sites.map(async (site) => {
        const homepage = state.pages.find((page) => page.siteId === site.id && page.route === "/" && !page.deletedAt);
        if (!homepage) return [site.id, undefined] as const;
        try {
          const html = await fs.readFile(path.join(site.repoPath, homepage.filePath), "utf8");
          const href = extractFaviconHref(html);
          if (!href) return [site.id, undefined] as const;
          return [site.id, resolveAssetRef(href, homepage.filePath, site.slug)] as const;
        } catch {
          return [site.id, undefined] as const;
        }
      })
    )
  );

  // Group mirror pairs so the "mirror" side always renders right under its "main" (source) site,
  // indented, instead of wherever it'd otherwise fall alphabetically — see SITE-MIRROR-01.
  const mirrorChildBySource = new Map<string, SiteRecord>();
  for (const site of sites) {
    if (site.metadata.mirrorOfSiteId) mirrorChildBySource.set(site.metadata.mirrorOfSiteId, site);
  }
  const allTopLevelSites = sites
    .filter((site) => !site.metadata.mirrorOfSiteId)
    .sort((a, b) => {
      if (Boolean(a.metadata.starred) !== Boolean(b.metadata.starred)) return a.metadata.starred ? -1 : 1;
      return a.metadata.name.localeCompare(b.metadata.name);
    });
  // Locked (WordPress/MODX/other dynamic) sites get their own section below, outside the
  // affiliate/PBN category folders — they're not something Igle CMS manages content for, so
  // grouping them by GEO alongside real editable sites would just be noise.
  const topLevelSites = allTopLevelSites.filter((site) => !site.metadata.contentLocked);
  const lockedSites = allTopLevelSites.filter((site) => site.metadata.contentLocked);

  // Two top-level "folders" — affiliate sites vs. a private blog network — each sub-divided by
  // GEO so a large batch of sites stays easy to scan. A mirror child always renders attached to
  // its main site (see SITE-MIRROR-01) and doesn't get its own GEO grouping.
  const categories: Array<{ key: "affiliate" | "pbn"; label: string }> = [
    { key: "affiliate", label: "Affiliate Sites" },
    { key: "pbn", label: "PBN Sites" }
  ];

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Sites</h1>
          <p className="muted">{sites.length} site{sites.length === 1 ? "" : "s"}</p>
        </div>
        {actor.role === "administrator" ? (
          <Link href="/sites/duplicates" className="button button-ghost">
            Review duplicates
          </Link>
        ) : null}
      </div>
      {imported ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Imported <strong>{imported}</strong> from the uploaded .zip.
        </article>
      ) : null}
      {importError ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          Import failed: {importError}
        </article>
      ) : null}
      {deleted ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Deleted <strong>{deleted}</strong>.
        </article>
      ) : null}
      <form
        className="card"
        method="post"
        action="/api/sites/import"
        encType="multipart/form-data"
        style={{ display: "grid", gap: 10, marginBottom: 28, maxWidth: 420 }}
      >
        <h2>Add site from .zip</h2>
        <p className="muted">Upload a .zip of static HTML files to create a new site.</p>
        <input type="text" name="name" placeholder="Site name" required />
        <input type="text" name="domain" placeholder="Domain (optional) — assign a server in Site Settings after" />
        <input type="file" name="file" accept=".zip" required />
        <button className="button" type="submit" style={{ justifySelf: "start" }}>
          Upload &amp; import
        </button>
      </form>

      {sites.length === 0 ? (
        <div className="list">
          <div className="list-row">
            <div className="main">
              <h3>No sites yet</h3>
              <p className="muted">Launch one from a template, or upload a .zip above.</p>
            </div>
          </div>
        </div>
      ) : null}
      {sites.length > 0 && categories.map((category) => {
        const categorySites = topLevelSites.filter((site) => (site.metadata.category ?? "affiliate") === category.key);

        const geoGroups = new Map<string, SiteRecord[]>();
        for (const site of categorySites) {
          const geo = site.metadata.country?.toUpperCase() || "No GEO set";
          const group = geoGroups.get(geo);
          if (group) group.push(site);
          else geoGroups.set(geo, [site]);
        }
        const geoKeys = [...geoGroups.keys()].sort((a, b) => {
          if (a === "No GEO set") return 1;
          if (b === "No GEO set") return -1;
          return a.localeCompare(b);
        });

        return (
          <section key={category.key} style={{ marginBottom: 32 }}>
            <h2 style={{ marginBottom: 12 }}>
              {category.label} <span className="muted">({categorySites.length})</span>
            </h2>
            {categorySites.length === 0 ? (
              <div className="list">
                <div className="list-row">
                  <p className="muted" style={{ margin: 0 }}>No sites in this folder yet.</p>
                </div>
              </div>
            ) : (
              geoKeys.map((geo) => (
                <div key={geo} style={{ marginBottom: 16 }}>
                  <h3 className="muted" style={{ fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 8px" }}>
                    {geo} <span>({geoGroups.get(geo)!.length})</span>
                  </h3>
                  <div className="list">
                    {geoGroups.get(geo)!.map((site) => {
                      const child = mirrorChildBySource.get(site.id);
                      return (
                        <SiteRow
                          key={site.id}
                          site={site}
                          state={state}
                          favicon={favicons.get(site.id)}
                          previewOrigin={previewOrigin}
                          isChild={false}
                          mirrorLabel={child ? `Mirrored by ${child.metadata.name}` : undefined}
                        >
                          {child ? (
                            <SiteRow
                              key={child.id}
                              site={child}
                              state={state}
                              favicon={favicons.get(child.id)}
                              previewOrigin={previewOrigin}
                              isChild
                              mirrorLabel={`Mirror of ${site.metadata.name}`}
                            />
                          ) : null}
                        </SiteRow>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </section>
        );
      })}
      {lockedSites.length > 0 ? (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ marginBottom: 4 }}>
            Managed externally (WordPress/MODX) <span className="muted">({lockedSites.length})</span>
          </h2>
          <p className="muted" style={{ margin: "0 0 12px", fontSize: 12.5 }}>
            Imported for reference only — Igle CMS only sees a file snapshot of these, so editing
            and deploying are disabled to avoid breaking the live install. Open a site to unlock
            it (administrators only).
          </p>
          <div className="list">
            {lockedSites.map((site) => (
              <SiteRow key={site.id} site={site} state={state} favicon={favicons.get(site.id)} previewOrigin={previewOrigin} isChild={false} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function SiteRow({
  site,
  state,
  favicon,
  previewOrigin,
  isChild,
  mirrorLabel,
  children
}: {
  site: SiteRecord;
  state: CoreState;
  favicon: AssetRef | undefined;
  previewOrigin: string;
  isChild: boolean;
  mirrorLabel?: string | undefined;
  children?: ReactNode;
}) {
  const revisions = state.revisions.filter((revision) => revision.siteId === site.id);
  const pages = state.pages.filter((page) => page.siteId === site.id && !page.deletedAt);
  const headRevisionNumber = revisions.at(-1)?.revisionNumber ?? 0;
  const productionRevision = site.productionRevisionId
    ? revisions.find((revision) => revision.id === site.productionRevisionId)
    : undefined;
  const revisionsAhead = productionRevision ? headRevisionNumber - productionRevision.revisionNumber : 0;
  const starred = Boolean(site.metadata.starred);
  const cloudflareDomain = state.domains.find((item) => item.siteId === site.id);

  return (
    <>
      <div
        className="list-row"
        style={
          isChild
            ? {
                marginLeft: 40,
                paddingLeft: 12,
                borderLeft: "2px solid var(--accent)",
                background: "color-mix(in srgb, var(--accent) 4%, transparent)"
              }
            : undefined
        }
      >
        <form method="post" action={`/api/sites/${site.id}/star`}>
          <button
            className="button"
            type="submit"
            title={starred ? "Unstar" : "Star"}
            aria-pressed={starred}
            style={{
              background: "none",
              border: "none",
              padding: "0 4px 0 0",
              fontSize: 18,
              lineHeight: 1,
              color: starred ? "#d4a017" : "var(--line)",
              flexShrink: 0
            }}
          >
            {starred ? "★" : "☆"}
          </button>
        </form>
        {favicon ? (
          favicon.kind === "absolute" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="thumb" src={favicon.url} alt="" />
          ) : (
            <PreviewImage className="thumb" originFallback={previewOrigin} path={favicon.path} alt="" />
          )
        ) : (
          <span className="thumb" aria-hidden />
        )}
        <div className="main">
          <h3>
            {isChild ? <span className="muted" style={{ marginRight: 4 }} aria-hidden>↳</span> : null}
            <Link href={`/sites/${site.id}`}>{site.metadata.name}</Link>
            {mirrorLabel ? (
              <span className="status" style={{ marginLeft: 8, fontSize: 11 }}>
                {mirrorLabel}
              </span>
            ) : null}
            {site.metadata.contentLocked ? (
              <span className="status" style={{ marginLeft: 8, fontSize: 11, color: "var(--warn)", borderColor: "var(--warn)" }}>
                Locked
              </span>
            ) : null}
          </h3>
          <p className="muted" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <span>
              {site.metadata.domain ?? "No domain"} · {pages.length} page{pages.length === 1 ? "" : "s"} · Rev #{headRevisionNumber}
              {" · "}
              {productionRevision ? (revisionsAhead > 0 ? `${revisionsAhead} ahead of production` : "Live") : "Never deployed"}
            </span>
            {cloudflareDomain ? (
              <span
                className="status"
                style={{ fontSize: 10.5, background: domainStatusColor[cloudflareDomain.status], color: "#fff", border: "none" }}
              >
                {domainStatusLabel[cloudflareDomain.status] ?? cloudflareDomain.status}
              </span>
            ) : site.metadata.domain ? (
              <span className="status" style={{ fontSize: 10.5, color: "var(--warn)", borderColor: "var(--warn)" }}>
                Not via Cloudflare
              </span>
            ) : null}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <Link
            href={`/sites/${site.id}`}
            className="button"
            style={{ background: "none", color: "var(--accent)", fontSize: 12.5, padding: "6px 10px" }}
          >
            Edit
          </Link>
          <PreviewLink
            originFallback={previewOrigin}
            path={`/${site.slug}/`}
            className="button"
            style={{ background: "none", color: "var(--accent)", fontSize: 12.5, padding: "6px 10px" }}
          >
            Preview
          </PreviewLink>
          {site.metadata.domain ? (
            <a
              className="button"
              href={`${site.metadata.https ? "https" : "http"}://${site.metadata.domain}/`}
              target="_blank"
              rel="noreferrer"
              style={{ background: "none", color: "var(--accent)", fontSize: 12.5, padding: "6px 10px" }}
            >
              Live
            </a>
          ) : null}
          <DeployButton siteId={site.id} disabled={site.metadata.contentLocked || (revisionsAhead === 0 && Boolean(productionRevision))} />
        </div>
      </div>
      {children}
    </>
  );
}
