import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { PreviewImage } from "../PreviewImage";
import { resolveAssetRef } from "../../lib/asset-ref";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";

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
          <p className="muted">Static site workspaces backed by Git revisions.</p>
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
      <section className="grid">
        {sites.map((site, index) => {
          const revisions = state.revisions.filter((revision) => revision.siteId === site.id);
          const pages = state.pages.filter((page) => page.siteId === site.id && !page.deletedAt);
          const favicon = favicons[index];
          return (
            <Link className="card card-link" href={`/sites/${site.id}`} key={site.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {favicon ? (
                  favicon.kind === "absolute" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={favicon.url} alt="" width={20} height={20} style={{ borderRadius: 4, flexShrink: 0 }} />
                  ) : (
                    <PreviewImage
                      originFallback={previewOrigin}
                      path={favicon.path}
                      alt=""
                      width={20}
                      height={20}
                      style={{ borderRadius: 4, flexShrink: 0 }}
                    />
                  )
                ) : (
                  <span
                    aria-hidden
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      background: "var(--bg)",
                      border: "1px solid var(--line)",
                      flexShrink: 0
                    }}
                  />
                )}
                <h2 style={{ margin: 0 }}>{site.metadata.name}</h2>
              </div>
              <p className="muted">{site.metadata.domain ?? "Domain not configured"}</p>
              <p>{pages.length} pages · Revision #{revisions.at(-1)?.revisionNumber ?? 0}</p>
              <span className="status">{site.productionRevisionId ? "Production configured" : "Never deployed"}</span>
            </Link>
          );
        })}
        {sites.length === 0 ? (
          <article className="card">
            <h2>No sites yet</h2>
          <p className="muted">No site workspaces have been created.</p>
          </article>
        ) : null}
      </section>
    </>
  );
}

function extractFaviconHref(html: string): string | undefined {
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const relMatch = /rel\s*=\s*["']([^"']+)["']/i.exec(tag);
    const rel = (relMatch?.[1] ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("icon")) continue;
    const hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (hrefMatch?.[1]) return hrefMatch[1];
  }
  return undefined;
}

