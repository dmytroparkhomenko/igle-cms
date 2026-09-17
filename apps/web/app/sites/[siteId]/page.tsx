import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { runtime } from "../../../lib/runtime";
import { requireActorOrRedirect } from "../../../lib/session";
import { ApplyLanguageButton } from "./ApplyLanguageButton";
import { DeployButton } from "./DeployButton";
import { DomainPicker } from "./DomainPicker";
import { FixLinksButton } from "./FixLinksButton";
import { PageRow } from "./PageRow";
import { PreviewLink } from "../../PreviewLink";

export default async function SiteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{
    updated?: string;
    settingsError?: string;
    restored?: string;
    restoreError?: string;
    deleteError?: string;
    revisionsLimit?: string;
    duplicated?: string;
    pageDeleted?: string;
    pageError?: string;
    deployed?: string;
    deployError?: string;
    rolledBack?: string;
  }>;
}) {
  const { siteId } = await params;
  const {
    updated,
    settingsError,
    restored,
    restoreError,
    deleteError,
    revisionsLimit: revisionsLimitRaw,
    duplicated,
    pageDeleted,
    pageError,
    deployed,
    deployError,
    rolledBack,
  } = await searchParams;
  const revisionsLimit = Math.max(10, Number(revisionsLimitRaw) || 10);
  const actor = await requireActorOrRedirect();
  const site = await runtime.siteService.get(siteId, actor);
  if (!site) notFound();

  const state = await runtime.stateStore.read();
  const pages = state.pages
    .filter((page) => page.siteId === site.id && !page.deletedAt)
    .slice()
    .sort((a, b) => a.route.localeCompare(b.route));
  const trashedCount = state.pages.filter(
    (page) => page.siteId === site.id && page.deletedAt,
  ).length;
  const revisions = state.revisions
    .filter((revision) => revision.siteId === site.id)
    .slice()
    .sort((a, b) => b.revisionNumber - a.revisionNumber);

  const previewOrigin = process.env.PREVIEW_ORIGIN ?? "http://localhost:3001";

  const headRevisionNumber = revisions[0]?.revisionNumber ?? 0;
  const productionRevision = site.productionRevisionId
    ? revisions.find((revision) => revision.id === site.productionRevisionId)
    : undefined;
  const revisionsAhead = productionRevision
    ? headRevisionNumber - productionRevision.revisionNumber
    : 0;
  const selectableServers = await runtime.serverService.listSelectable(actor);
  const assignedServerId = site.metadata.serverId;
  const assignedServer = assignedServerId
    ? selectableServers.find((server) => server.id === assignedServerId)
    : undefined;
  const aapanelDomain =
    site.metadata.deploymentTarget === "aapanel"
      ? site.metadata.domain
      : undefined;
  const [aapanelDns, aapanelSiteLookup] =
    assignedServerId && aapanelDomain
      ? await Promise.all([
          runtime.deployService
            .checkAaPanelDns(assignedServerId, actor, aapanelDomain)
            .catch(() => null),
          runtime.deployService
            .findExistingAaPanelSite(assignedServerId, actor, aapanelDomain)
            .then((site_) => ({ ok: true as const, site: site_ }))
            .catch((error: unknown) => ({
              ok: false as const,
              error: error instanceof Error ? error.message : "Lookup failed.",
            })),
        ])
      : [null, null];
  const aapanelDomainOptions = assignedServerId
    ? await runtime.deployService
        .listAaPanelSites(assignedServerId, actor)
        .catch(() => [])
    : [];

  const currentRobotsTxt = await fs
    .readFile(path.join(site.repoPath, "robots.txt"), "utf8")
    .catch(() => "");
  const excludedFromSitemap = pages.filter((page) => !page.inSitemap);

  const protocol = site.metadata.https ? "https" : "http";
  const sitemapBase = site.metadata.domain
    ? `${protocol}://${site.metadata.domain}`
    : "https://your-domain.example";
  const generatedRobotsPreview = `User-agent: *\nAllow: /\n${
    site.metadata.sitemap.enabled ? `Sitemap: ${sitemapBase}/sitemap.xml\n` : ""
  }`;

  const shownRevisions = revisions.slice(0, revisionsLimit);
  const revisionsWithDiff = await Promise.all(
    shownRevisions.map(async (revision) => {
      if (revision.revisionNumber <= 1) return { revision, diff: "" };
      try {
        const diff = await runtime.revisionService.compare(
          site,
          revision.revisionNumber - 1,
          revision.revisionNumber,
        );
        return { revision, diff };
      } catch {
        return { revision, diff: "" };
      }
    }),
  );

  return (
    <>
      <p style={{ marginTop: 0, marginBottom: 14 }}>
        <Link href="/sites">&larr; Back to sites</Link>
      </p>
      <div className="toolbar">
        <div>
          <h1>{site.metadata.name}</h1>
          <p className="muted">
            {pages.length} pages · Revision #{headRevisionNumber}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <PreviewLink
            originFallback={previewOrigin}
            path={`/${site.slug}/`}
            className="button"
            style={{ background: "none", color: "var(--accent)" }}
          >
            Open preview
          </PreviewLink>
          {site.metadata.domain ? (
            <a
              className="button"
              href={`${site.metadata.https ? "https" : "http"}://${site.metadata.domain}/`}
              target="_blank"
              rel="noreferrer"
              style={{ background: "none", color: "var(--accent)" }}
            >
              View live site
            </a>
          ) : null}
          <DeployButton
            siteId={site.id}
            disabled={revisionsAhead === 0 && Boolean(productionRevision)}
          />
        </div>
      </div>

      <div className="version-tiles">
        <div className="version-tile">
          <p className="version-tile-label">Last saved version</p>
          <p className="version-tile-value">#{headRevisionNumber}</p>
          <p className="version-tile-meta">
            {revisions[0]
              ? `${revisions[0].title} · ${new Date(revisions[0].createdAt).toLocaleString()}`
              : "No revisions yet"}
          </p>
        </div>
        <div className="version-tile">
          <p className="version-tile-label">Currently deployed</p>
          {productionRevision ? (
            <>
              <p
                className="version-tile-value"
                style={{ color: "var(--accent)" }}
              >
                #{productionRevision.revisionNumber}
              </p>
              <p className="version-tile-meta">
                {revisionsAhead > 0
                  ? `Draft ${revisionsAhead} revision${revisionsAhead === 1 ? "" : "s"} ahead`
                  : "Matches last saved version"}
              </p>
            </>
          ) : (
            <>
              <p className="version-tile-value muted">Never deployed</p>
              <p className="version-tile-meta">
                Click &quot;Deploy to production&quot; above to publish the last
                saved version.
              </p>
            </>
          )}
        </div>
      </div>

      {updated ? (
        <article
          className="card"
          style={{ borderColor: "var(--accent)", marginBottom: 16 }}
        >
          Site settings updated.
        </article>
      ) : null}
      {settingsError ? (
        <article
          className="card"
          style={{ borderColor: "var(--warn)", marginBottom: 16 }}
        >
          Update failed: {settingsError}
        </article>
      ) : null}
      {restored ? (
        <article
          className="card"
          style={{ borderColor: "var(--accent)", marginBottom: 16 }}
        >
          Restored — now revision #{restored}.
        </article>
      ) : null}
      {restoreError ? (
        <article
          className="card"
          style={{ borderColor: "var(--warn)", marginBottom: 16 }}
        >
          Restore failed: {restoreError}
        </article>
      ) : null}
      {duplicated ? (
        <article
          className="card"
          style={{ borderColor: "var(--accent)", marginBottom: 16 }}
        >
          Page duplicated.
        </article>
      ) : null}
      {pageDeleted ? (
        <article
          className="card"
          style={{ borderColor: "var(--accent)", marginBottom: 16 }}
        >
          Page moved to trash.{" "}
          <Link href={`/sites/${site.id}/trash`}>View trash</Link>
        </article>
      ) : null}
      {pageError ? (
        <article
          className="card"
          style={{ borderColor: "var(--warn)", marginBottom: 16 }}
        >
          {pageError}
        </article>
      ) : null}
      {deployed ? (
        <article
          className="card"
          style={{ borderColor: "var(--accent)", marginBottom: 16 }}
        >
          Deployed revision #{deployed} to production.
        </article>
      ) : null}
      {deployError ? (
        <article
          className="card"
          style={{ borderColor: "var(--warn)", marginBottom: 16 }}
        >
          Deploy failed: {deployError}
        </article>
      ) : null}
      {rolledBack ? (
        <article
          className="card"
          style={{ borderColor: "var(--accent)", marginBottom: 16 }}
        >
          Rolled back production to revision #{rolledBack}.
        </article>
      ) : null}

      <div className="card settings-card">
        <div className="settings-card-header">
          <h2>Site settings</h2>
          <div className="quick-links">
            <Link href={`/deployments?siteId=${site.id}`}>
              Deployment history
            </Link>
            <Link href={`/sites/${site.id}/redirects`}>Redirects</Link>
            <Link href={`/sites/${site.id}/scripts`}>Scripts</Link>
            <Link href={`/sites/${site.id}/header-footer`}>Header/Footer</Link>
          </div>
        </div>

        <form method="post" action={`/api/sites/${site.id}/settings`}>
          <div className="settings-section">
            <p className="settings-section-title">Identity</p>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input
                type="text"
                id="name"
                name="name"
                defaultValue={site.metadata.name}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="domain">Domain</label>
              <DomainPicker
                initialValue={site.metadata.domain ?? ""}
                options={aapanelDomainOptions}
              />
            </div>
          </div>

          <div className="settings-section">
            <p className="settings-section-title">Localization</p>
            <div className="field-row">
              <div className="field">
                <label htmlFor="language">Language</label>
                <input
                  type="text"
                  id="language"
                  name="language"
                  defaultValue={site.metadata.language}
                  maxLength={2}
                  placeholder="en"
                />
              </div>
              <div className="field">
                <label htmlFor="country">Country (GEO)</label>
                <input
                  type="text"
                  id="country"
                  name="country"
                  defaultValue={site.metadata.country ?? ""}
                  maxLength={2}
                  placeholder="US"
                />
              </div>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
              Sets <code>&lt;html lang&gt;</code> for new pages and the
              site&apos;s GEO for SEO defaults. Existing pages keep their
              current <code>lang</code> attribute — this doesn&apos;t rewrite
              them.
            </p>
            <ApplyLanguageButton siteId={site.id} />
          </div>

          <div
            className={`settings-section ${selectableServers.length > 0 ? "deploy-target-switch" : ""}`}
          >
            <p className="settings-section-title">Deployment</p>
            <label
              className="muted"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                name="https"
                defaultChecked={site.metadata.https}
              />
              Force HTTPS
            </label>
            {selectableServers.length > 0 ? (
              <div className="field">
                <label htmlFor="deploymentTarget">Deploy to</label>
                <select
                  id="deploymentTarget"
                  name="deploymentTarget"
                  defaultValue={site.metadata.deploymentTarget}
                >
                  <option value="local">Local filesystem (this server)</option>
                  <option value="aapanel">aaPanel VPS</option>
                </select>
              </div>
            ) : null}
            {/* Shown/hidden purely by CSS (:has() on the select above, see .deploy-target-switch) —
                so picking "aaPanel VPS" reveals the server field immediately, in the same
                submission, instead of needing a save-and-reload before it even appears. */}
            <div className="field aapanel-only-field">
              <label htmlFor="serverId">Server</label>
              <select
                id="serverId"
                name="serverId"
                defaultValue={assignedServerId ?? ""}
              >
                <option value="">Pick a server…</option>
                {selectableServers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                    {server.restricted ? " (restricted)" : ""}
                  </option>
                ))}
              </select>
              {!assignedServerId ? (
                <p
                  className="muted"
                  style={{ margin: "4px 0 0", fontSize: 11.5 }}
                >
                  Pick which registered server this site deploys to, then save
                  and deploy. Changing this later moves the site — its next
                  deploy uploads to the new server; the old copy is left in
                  place unless you remove it there yourself.
                </p>
              ) : null}
            </div>
            {assignedServer ? (
              <p
                className="muted aapanel-only-field"
                style={{ margin: 0, fontSize: 11.5 }}
              >
                Deploys create/reuse a site on{" "}
                <strong>{assignedServer.name}</strong> for{" "}
                <code>{site.metadata.domain || "the domain above"}</code>,
                upload the build there, and request SSL if &quot;Force
                HTTPS&quot; is on. Set the domain above before deploying.
              </p>
            ) : null}
            {aapanelDomain && aapanelDns ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 11.5,
                  color: aapanelDns.matches ? "var(--accent)" : "var(--warn)",
                }}
              >
                {aapanelDns.matches
                  ? `DNS OK — ${aapanelDomain} points to this server.`
                  : aapanelDns.error
                    ? `DNS: ${aapanelDns.error} — the deploy will still upload files, but the live check afterward will fail until this is fixed.`
                    : `DNS mismatch — ${aapanelDomain} resolves to ${aapanelDns.resolvedIps.join(", ") || "nothing"}, not this server (${aapanelDns.serverIps.join(", ") || "unknown"}). Files will upload fine, but the live check afterward will fail until DNS points here.`}
              </p>
            ) : null}
            {aapanelDomain && aapanelSiteLookup ? (
              <p
                className="muted"
                style={{
                  margin: 0,
                  fontSize: 11.5,
                  color: aapanelSiteLookup.ok ? undefined : "var(--warn)",
                }}
              >
                {!aapanelSiteLookup.ok
                  ? `Couldn't check aaPanel for an existing site: ${aapanelSiteLookup.error}`
                  : aapanelSiteLookup.site
                    ? `Already exists in aaPanel at ${aapanelSiteLookup.site.documentRoot} — deploys will upload into it.`
                    : "No matching site in aaPanel yet — the first deploy will create one."}
              </p>
            ) : null}
          </div>

          <button
            className="button"
            type="submit"
            style={{ justifySelf: "start" }}
          >
            Save settings
          </button>
        </form>
      </div>

      <details className="card" style={{ marginBottom: 28, maxWidth: 640 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          Indexing, Sitemap &amp; Robots
        </summary>
        <form
          method="post"
          action={`/api/sites/${site.id}/sitemap-robots`}
          className="mode-switch"
          style={{ display: "grid", gap: 10, marginTop: 16 }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              name="sitemapEnabled"
              defaultChecked={site.metadata.sitemap.enabled}
            />
            Generate sitemap.xml at build
          </label>
          {excludedFromSitemap.length > 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              {excludedFromSitemap.length} page
              {excludedFromSitemap.length === 1 ? "" : "s"} excluded (set
              per-page under Additional SEO Settings):{" "}
              {excludedFromSitemap.map((page) => page.route).join(", ")}
            </p>
          ) : null}

          <p className="muted" style={{ margin: "10px 0 0", fontSize: 12.5 }}>
            Meta tag
          </p>
          <div className="field">
            <select
              id="metaRobots"
              name="metaRobots"
              defaultValue={site.metadata.metaRobots ?? "index"}
            >
              <option value="index">Index</option>
              <option value="noindex">Noindex</option>
            </select>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Adds{" "}
            <code>
              &lt;meta name=&quot;robots&quot; content=&quot;noindex&quot;&gt;
            </code>{" "}
            to every page at build time — a page that already sets its own
            robots meta tag (via its SEO fields) keeps controlling itself and is
            left alone. Useful for a site that&apos;s still being built and
            shouldn&apos;t show up in search yet.
          </p>

          <p className="muted" style={{ margin: "10px 0 0", fontSize: 12.5 }}>
            robots.txt
          </p>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="radio"
              name="robotsMode"
              value="cms-generated"
              defaultChecked={site.metadata.robots.mode !== "manual"}
            />
            CMS-generated — written automatically from these settings
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="radio"
              name="robotsMode"
              value="manual"
              defaultChecked={site.metadata.robots.mode === "manual"}
            />
            Manual — you control the exact file
          </label>

          <div className="mode-panel" data-panel="cms-generated">
            <p className="muted" style={{ margin: "0 0 6px", fontSize: 12.5 }}>
              This is what gets written at build/deploy time. It updates
              automatically from the settings above — there&apos;s nothing to
              edit here. Switch to Manual if you need rules this can&apos;t
              express (custom disallow rules, crawl-delay, multiple bot blocks).
            </p>
            <pre className="diff-view">{generatedRobotsPreview}</pre>
          </div>

          <div className="mode-panel" data-panel="manual">
            <p className="muted" style={{ margin: "0 0 6px", fontSize: 12.5 }}>
              Written exactly as entered — Igle never modifies this file once
              it&apos;s in Manual mode.
            </p>
            <textarea
              name="robotsContent"
              defaultValue={
                site.metadata.robots.mode === "manual"
                  ? (site.metadata.robots.content ?? currentRobotsTxt)
                  : currentRobotsTxt
              }
              placeholder={"User-agent: *\nAllow: /"}
              rows={6}
              style={textareaStyle}
            />
          </div>

          <button
            className="button"
            type="submit"
            style={{ justifySelf: "start", marginTop: 6 }}
          >
            Save sitemap, robots &amp; meta tag
          </button>
        </form>
      </details>

      <details className="card" style={{ marginBottom: 28, maxWidth: 640 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Internal links</summary>
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Imported sites often use relative links (e.g. <code>./bono/</code>) that only resolve correctly from
            pages at the exact depth the author assumed — usually the site root. The same link breaks the moment
            it&apos;s reused on a page nested one level deeper (served at, say, <code>/app/</code>), silently turning
            into <code>/app/bono/</code> and 404ing. This scans every page and rewrites links, images, stylesheets
            and scripts to absolute paths that work regardless of nesting.
          </p>
          <FixLinksButton siteId={site.id} />
        </div>
      </details>

      <div className="toolbar" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>
          Pages <span className="muted">({pages.length})</span>
        </h2>
        <div style={{ display: "flex", gap: 10 }}>
          <Link
            href={`/sites/${site.id}/trash`}
            className="button"
            style={{ background: "none", color: "var(--muted)" }}
          >
            Trash{trashedCount > 0 ? ` (${trashedCount})` : ""}
          </Link>
          <Link
            href={`/sites/${site.id}/bulk-seo`}
            className="button"
            style={{ background: "none", color: "var(--accent)" }}
          >
            Bulk edit SEO
          </Link>
        </div>
      </div>
      <div className="list" style={{ marginBottom: 28 }}>
        {pages.map((page) => (
          <PageRow siteId={site.id} page={page} key={page.id} />
        ))}
        {pages.length === 0 ? (
          <div className="list-row">
            <div className="main">
              <h3>No pages yet</h3>
              <p className="muted">Import or add pages to this site.</p>
            </div>
          </div>
        ) : null}
      </div>

      <h2 id="revisions">
        Revisions{" "}
        <span className="muted">
          (showing {shownRevisions.length} of {revisions.length})
        </span>
      </h2>
      <div className="list" style={{ marginBottom: 28 }}>
        {revisionsWithDiff.map(({ revision, diff }) => (
          <div
            className="list-row"
            key={revision.id}
            style={{ alignItems: "flex-start" }}
          >
            <details style={{ flex: 1, minWidth: 0 }}>
              <summary style={{ cursor: "pointer" }}>
                <span style={{ display: "inline-block" }}>
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: 14,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    #{revision.revisionNumber} — {revision.title}
                    {revision.id === site.productionRevisionId ? (
                      <span className="badge badge-production">Production</span>
                    ) : null}
                    {revision.revisionNumber === headRevisionNumber ? (
                      <span className="badge badge-current">Current</span>
                    ) : null}
                  </span>
                  <p
                    className="muted"
                    style={{ margin: "2px 0 0", fontSize: 12.5 }}
                  >
                    {revision.source} ·{" "}
                    {new Date(revision.createdAt).toLocaleString()}
                  </p>
                </span>
              </summary>
              <div style={{ marginTop: 10 }}>
                {diff ? (
                  <pre className="diff-view">
                    {diff.split("\n").map((line, index) => {
                      const cls =
                        line.startsWith("+") && !line.startsWith("+++")
                          ? "diff-add"
                          : line.startsWith("-") && !line.startsWith("---")
                            ? "diff-remove"
                            : line.startsWith("@@")
                              ? "diff-hunk"
                              : undefined;
                      return (
                        <span className={cls} key={index}>
                          {line}
                        </span>
                      );
                    })}
                  </pre>
                ) : (
                  <p className="muted" style={{ fontSize: 12.5 }}>
                    {revision.revisionNumber <= 1
                      ? "Initial revision — nothing to compare against."
                      : "No file changes recorded."}
                  </p>
                )}
              </div>
            </details>
            {revision.revisionNumber !== headRevisionNumber ? (
              <form
                method="post"
                action={`/api/sites/${site.id}/revisions/${revision.revisionNumber}/restore`}
              >
                <button
                  className="button"
                  type="submit"
                  style={{
                    background: "none",
                    color: "var(--accent)",
                    fontSize: 12.5,
                    padding: "6px 10px",
                  }}
                >
                  Restore
                </button>
              </form>
            ) : null}
          </div>
        ))}
      </div>
      {revisions.length > shownRevisions.length ? (
        <p style={{ marginTop: -18, marginBottom: 28 }}>
          <Link
            href={`/sites/${site.id}?revisionsLimit=${revisionsLimit + 10}#revisions`}
            className="button"
            style={{ background: "none", color: "var(--accent)" }}
          >
            Load more revisions
          </Link>
        </p>
      ) : null}

      <details
        className="card danger-zone"
        style={{ marginBottom: 28, maxWidth: 480 }}
      >
        <summary
          style={{ cursor: "pointer", fontWeight: 600, color: "var(--warn)" }}
        >
          Danger Zone
        </summary>
        {deleteError ? (
          <p style={{ color: "var(--warn)", fontSize: 12.5 }}>{deleteError}</p>
        ) : null}
        <form
          method="post"
          action={`/api/sites/${site.id}/delete`}
          style={{ display: "grid", gap: 8, marginTop: 12 }}
        >
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Permanently deletes this site&apos;s files and full revision
            history. This cannot be undone. Type the site slug (
            <strong>{site.slug}</strong>) to confirm.
          </p>
          <input
            type="text"
            name="confirmSlug"
            placeholder={site.slug}
            autoComplete="off"
          />
          <button
            className="button"
            type="submit"
            style={{
              background: "var(--warn)",
              borderColor: "var(--warn)",
              justifySelf: "start",
            }}
          >
            Delete this site permanently
          </button>
        </form>
      </details>
    </>
  );
}

const textareaStyle = {
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "8px 10px",
  font: "inherit",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 13,
  color: "var(--text)",
  background: "var(--panel)",
  resize: "vertical" as const,
};
