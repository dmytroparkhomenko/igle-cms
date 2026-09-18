import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { PreviewImage } from "../PreviewImage";
import { PreviewLink } from "../PreviewLink";
import { resolveAssetRef } from "../../lib/asset-ref";
import { extractFaviconHref } from "../../lib/favicon";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";
import { DeployButton } from "./[siteId]/DeployButton";

export default async function SitesPage({
  searchParams
}: {
  searchParams: Promise<{ imported?: string; importError?: string; deleted?: string }>;
}) {
  const sites = await runtime.siteService.list((await requireActorOrRedirect()));
  const state = await runtime.stateStore.read();
  const { imported, importError, deleted } = await searchParams;
  const previewOrigin = process.env.PREVIEW_ORIGIN ?? "http://localhost:3001";

  const favicons = await Promise.all(
    sites.map(async (site) => {
      const homepage = state.pages.find((page) => page.siteId === site.id && page.route === "/" && !page.deletedAt);
      if (!homepage) return undefined;
      try {
        const html = await fs.readFile(path.join(site.repoPath, homepage.filePath), "utf8");
        const href = extractFaviconHref(html);
        if (!href) return undefined;
        return resolveAssetRef(href, homepage.filePath, site.slug);
      } catch {
        return undefined;
      }
    })
  );

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Sites</h1>
          <p className="muted">{sites.length} site{sites.length === 1 ? "" : "s"}</p>
        </div>
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

      <div className="list">
        {sites.map((site, index) => {
          const revisions = state.revisions.filter((revision) => revision.siteId === site.id);
          const pages = state.pages.filter((page) => page.siteId === site.id && !page.deletedAt);
          const headRevisionNumber = revisions.at(-1)?.revisionNumber ?? 0;
          const productionRevision = site.productionRevisionId
            ? revisions.find((revision) => revision.id === site.productionRevisionId)
            : undefined;
          const revisionsAhead = productionRevision ? headRevisionNumber - productionRevision.revisionNumber : 0;
          const favicon = favicons[index];
          const mirrorPartner = site.metadata.mirrorOfSiteId
            ? sites.find((item) => item.id === site.metadata.mirrorOfSiteId)
            : sites.find((item) => item.metadata.mirrorOfSiteId === site.id);

          return (
            <div className="list-row" key={site.id}>
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
                  <Link href={`/sites/${site.id}`}>{site.metadata.name}</Link>
                  {mirrorPartner ? (
                    <span className="status" style={{ marginLeft: 8, fontSize: 11 }}>
                      Mirrored with {mirrorPartner.metadata.name}
                    </span>
                  ) : null}
                </h3>
                <p className="muted">
                  {site.metadata.domain ?? "No domain"} · {pages.length} page{pages.length === 1 ? "" : "s"} · Rev #{headRevisionNumber}
                  {" · "}
                  {productionRevision ? (revisionsAhead > 0 ? `${revisionsAhead} ahead of production` : "Live") : "Never deployed"}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
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
                <DeployButton siteId={site.id} disabled={revisionsAhead === 0 && Boolean(productionRevision)} />
              </div>
            </div>
          );
        })}
        {sites.length === 0 ? (
          <div className="list-row">
            <div className="main">
              <h3>No sites yet</h3>
              <p className="muted">Launch one from a template, or upload a .zip above.</p>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
