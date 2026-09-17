import fs from "node:fs/promises";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { parsePageSEO } from "@igle/html-engine";
import { effectiveSiteLanguageTag, resolveInside } from "@igle/shared";
import { resolveAssetRef } from "../../../../../lib/asset-ref";
import { runtime } from "../../../../../lib/runtime";
import { requireActorOrRedirect } from "../../../../../lib/session";
import { PreviewImage } from "../../../../PreviewImage";
import { PreviewLink } from "../../../../PreviewLink";

export default async function PageEditor({
  params,
  searchParams
}: {
  params: Promise<{ siteId: string; pageId: string }>;
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const { siteId, pageId } = await params;
  const { updated, error } = await searchParams;
  const site = await runtime.siteService.get(siteId, (await requireActorOrRedirect()));
  if (!site) notFound();

  const state = await runtime.stateStore.read();
  const page = state.pages.find((item) => item.siteId === site.id && item.id === pageId);
  if (!page) notFound();
  if (page.deletedAt) redirect(`/sites/${site.id}/trash`);

  const html = await fs.readFile(resolveInside(site.repoPath, page.filePath), "utf8");
  const parsed = parsePageSEO(html);
  const limits = site.metadata.seoLimits;

  const previewOrigin = process.env.PREVIEW_ORIGIN ?? "http://localhost:3001";
  const displayUrl = `${site.metadata.domain ?? site.slug}${page.route}`;

  const h1Editable = parsed.h1.state !== "ambiguous" && !parsed.h1.readOnly;
  const siteLangTag = effectiveSiteLanguageTag(site.metadata);

  return (
    <>
      <p style={{ marginTop: 0, marginBottom: 14 }}>
        <Link href={`/sites/${site.id}`}>&larr; Back to {site.metadata.name}</Link>
      </p>
      <div className="toolbar">
        <div>
          <h1>{page.internalName}</h1>
          <p className="muted">
            {page.route} · <PreviewLink originFallback={previewOrigin} path={`/${site.slug}${page.route}`}>Preview</PreviewLink>
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href={`/sites/${site.id}/pages/${page.id}/visual`} className="button">
            Open visual editor
          </Link>
          <Link href={`/sites/${site.id}/pages/${page.id}/code`} className="button" style={{ background: "none", color: "var(--accent)" }}>
            Edit source
          </Link>
        </div>
      </div>

      {updated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Saved as revision #{updated}.
        </article>
      ) : null}
      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          Save failed: {error}
        </article>
      ) : null}

      <article className="card" style={{ marginBottom: 20, maxWidth: 560 }}>
        <p className="muted" style={{ margin: "0 0 4px", fontSize: 12 }}>
          Search result preview
        </p>
        <div style={{ fontFamily: "arial, sans-serif" }}>
          <div style={{ color: "#1a0dab", fontSize: 18, lineHeight: 1.3 }}>{page.seoTitle || page.internalName}</div>
          <div style={{ color: "#006621", fontSize: 13 }}>{displayUrl}</div>
          <div style={{ color: "#545454", fontSize: 13 }}>{page.metaDescription || "No description set."}</div>
        </div>
      </article>

      <details className="card" style={{ marginBottom: 20, maxWidth: 640 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Page slug</summary>
        <form
          method="post"
          action={`/api/sites/${site.id}/pages/${page.id}/rename`}
          style={{ display: "grid", gap: 8, marginTop: 14 }}
        >
          <label className="muted" htmlFor="filePath" style={{ fontSize: 12.5 }}>
            File path
          </label>
          <input type="text" id="filePath" name="filePath" defaultValue={page.filePath} />
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="addRedirect" defaultChecked />
            Redirect the old URL ({page.route}) to the new one
          </label>
          <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
            This moves the file and updates this page&apos;s own route. It doesn&apos;t rewrite links to it from other
            pages on the site — add the redirect above, or update those links by hand.
          </p>
          <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 4 }}>
            Rename page
          </button>
        </form>
      </details>

      <form
        className="card"
        method="post"
        action={`/api/sites/${site.id}/pages/${page.id}/seo`}
        style={{ display: "grid", gap: 10, marginBottom: 28, maxWidth: 640 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <label htmlFor="seoTitle">SEO Title</label>
          <FieldMeta state={page.fieldStates.seoTitle ?? "absent"} length={page.seoTitle?.length ?? 0} min={limits.titleMin} max={limits.titleMax} />
        </div>
        <input type="text" id="seoTitle" name="seoTitle" defaultValue={page.seoTitle ?? ""} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
          <label htmlFor="metaDescription">Meta Description</label>
          <FieldMeta
            state={page.fieldStates.metaDescription ?? "absent"}
            length={page.metaDescription?.length ?? 0}
            min={limits.descriptionMin}
            max={limits.descriptionMax}
          />
        </div>
        <textarea id="metaDescription" name="metaDescription" defaultValue={page.metaDescription ?? ""} rows={3} style={textareaStyle} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
          <label htmlFor="h1">H1</label>
          <StateBadge state={parsed.h1.state} />
        </div>
        {h1Editable ? (
          <input type="text" id="h1" name="h1" defaultValue={page.h1 ?? ""} />
        ) : (
          <div className="card" style={{ background: "var(--bg)" }}>
            <p style={{ margin: 0 }}>{page.h1 || "(none)"}</p>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>
              {parsed.h1.state === "ambiguous"
                ? "Multiple H1 elements found — read-only until resolved in source."
                : "This H1 contains nested elements and must be edited visually or in source."}
            </p>
          </div>
        )}

        <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 10 }}>
          Save
        </button>
      </form>

      <details className="card" style={{ marginBottom: 28, maxWidth: 640 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Additional SEO Settings</summary>
        <form
          method="post"
          action={`/api/sites/${site.id}/pages/${page.id}/seo`}
          style={{ display: "grid", gap: 10, marginTop: 16 }}
        >
          <input type="hidden" name="expertFormSubmitted" value="1" />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label htmlFor="lang">Language</label>
            <StateBadge state={page.fieldStates.lang ?? "absent"} />
          </div>
          <input type="text" id="lang" name="lang" defaultValue={page.lang ?? siteLangTag} maxLength={10} style={{ maxWidth: 100 }} />
          <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
            Follows the site language ({siteLangTag}) by default — language and country combine automatically. Set a
            different code to override just this page (e.g. a translated version); clear it or set it back to match to
            inherit again.
          </p>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
            <label htmlFor="canonical">Canonical URL</label>
            <StateBadge state={parsed.canonical.state} />
          </div>
          <input type="text" id="canonical" name="canonical" defaultValue={page.canonical ?? ""} placeholder={`${site.metadata.domain ?? site.slug}${page.route}`} />

          <div style={{ display: "flex", gap: 20, marginTop: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="noindex" defaultChecked={/noindex/i.test(page.robots ?? "")} />
              Noindex
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="nofollow" defaultChecked={/nofollow/i.test(page.robots ?? "")} />
              Nofollow
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
            <label htmlFor="ogTitle">Open Graph Title</label>
            <StateBadge state={parsed.ogTitle.state} />
          </div>
          <input type="text" id="ogTitle" name="ogTitle" defaultValue={page.ogTitle ?? ""} placeholder={page.seoTitle || "Defaults to SEO Title"} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
            <label htmlFor="ogDescription">Open Graph Description</label>
            <StateBadge state={parsed.ogDescription.state} />
          </div>
          <textarea
            id="ogDescription"
            name="ogDescription"
            defaultValue={page.ogDescription ?? ""}
            placeholder={page.metaDescription || "Defaults to Meta Description"}
            rows={2}
            style={textareaStyle}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <input type="checkbox" name="inSitemap" defaultChecked={page.inSitemap} />
            Include this page in the sitemap
          </label>

          <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 10 }}>
            Save additional settings
          </button>
        </form>
      </details>

      <h2>
        Images on this page <span className="muted">({parsed.images.length})</span>
      </h2>
      <div className="list" style={{ marginBottom: 28 }}>
        {parsed.images.map((image, index) => (
          <details key={`${image.src}-${index}`} style={{ borderBottom: "1px solid var(--line)" }}>
            <summary className="list-row" style={{ cursor: "pointer", borderBottom: "none", listStyle: "none" }}>
              {(() => {
                const ref = resolveAssetRef(image.src, page.filePath, site.slug);
                return ref.kind === "absolute" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="thumb" src={ref.url} alt="" loading="lazy" />
                ) : (
                  <PreviewImage className="thumb" originFallback={previewOrigin} path={ref.path} alt="" loading="lazy" />
                );
              })()}
              <div className="main">
                <p className="muted" style={{ margin: 0, wordBreak: "break-all" }}>{image.src}</p>
              </div>
              <div className="side">
                {image.decorative ? (
                  <span className="status">Decorative</span>
                ) : image.alt ? (
                  image.alt
                ) : (
                  <span className="status" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>Missing ALT text</span>
                )}
              </div>
            </summary>
            <form
              method="post"
              action={`/api/sites/${site.id}/pages/${page.id}/image`}
              encType="multipart/form-data"
              style={{ display: "grid", gap: 8, padding: "12px 14px 16px", background: "var(--bg)" }}
            >
              <input type="hidden" name="nodeId" value={image.nodeId} />
              <label className="muted" style={{ fontSize: 12.5 }}>Replace with a URL</label>
              <input type="text" name="url" placeholder="https://example.com/new-image.jpg" />
              <label className="muted" style={{ fontSize: 12.5 }}>Or upload a file</label>
              <input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/avif" />
              <label className="muted" style={{ fontSize: 12.5 }}>ALT text</label>
              <input type="text" name="alt" defaultValue={image.alt ?? ""} placeholder="Describe the image for accessibility" />
              <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 4 }}>
                Replace image
              </button>
            </form>
          </details>
        ))}
        {parsed.images.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>No images on this page.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}

function FieldMeta({ state, length, min, max }: { state: string; length: number; min: number; max: number }) {
  const color = length === 0 ? "var(--muted)" : length < min || length > max ? "var(--warn)" : "var(--accent)";
  return (
    <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span style={{ fontSize: 12, color, fontVariantNumeric: "tabular-nums" }}>
        {length} / {min}–{max}
      </span>
      <StateBadge state={state} />
    </span>
  );
}

function StateBadge({ state }: { state: string }) {
  const labels: Record<string, string> = {
    inherited: "Inherited",
    explicit: "Explicit",
    "manual-source": "Manual Source",
    absent: "Absent",
    ambiguous: "Ambiguous"
  };
  return <span className="status">{labels[state] ?? state}</span>;
}

const textareaStyle = {
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "8px 10px",
  font: "inherit",
  color: "var(--text)",
  background: "var(--panel)",
  resize: "vertical" as const
};
