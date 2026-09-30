import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findTaggedCtaLinks, findUnmarkedExternalLinks } from "@igle/html-engine";
import { runtime } from "../../../../lib/runtime";
import { requireActorOrRedirect } from "../../../../lib/session";
import { AffiliateCtaTools, type TaggedLinkRow, type UncloakedLinkRow } from "../AffiliateCtaTools";

export default async function AffiliateLinkPage({
  params,
  searchParams
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const { siteId } = await params;
  const { updated, error } = await searchParams;
  const site = await runtime.siteService.get(siteId, (await requireActorOrRedirect()));
  if (!site) notFound();

  const resolvedDestination = await runtime.affiliateLinkService.resolveForSite(site);

  const state = await runtime.stateStore.read();
  const pages = state.pages.filter((page) => page.siteId === site.id && !page.deletedAt);
  const taggedLinks: TaggedLinkRow[] = (
    await Promise.all(
      pages.map(async (page) => {
        try {
          const html = await fs.readFile(path.join(site.repoPath, page.filePath), "utf8");
          return findTaggedCtaLinks(html).map((link) => ({
            pageId: page.id,
            pageInternalName: page.internalName,
            nodeId: link.nodeId,
            tagName: link.tagName,
            slot: link.slot,
            text: link.text,
            href: link.href
          }));
        } catch {
          return [];
        }
      })
    )
  ).flat();
  const unmarkedLinks: UncloakedLinkRow[] = (
    await Promise.all(
      pages.map(async (page) => {
        try {
          const html = await fs.readFile(path.join(site.repoPath, page.filePath), "utf8");
          return findUnmarkedExternalLinks(html)
            .filter((link) => !site.metadata.domain || new URL(link.href).hostname.toLowerCase() !== site.metadata.domain.toLowerCase())
            .map((link) => ({ pageId: page.id, pageInternalName: page.internalName, nodeId: link.nodeId, href: link.href, text: link.text }));
        } catch {
          return [];
        }
      })
    )
  ).flat();

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Affiliate Link — {site.metadata.name}</h1>
          <p className="muted">Where this site&apos;s tagged CTAs (buttons, images, links) redirect to.</p>
        </div>
        <Link href={`/sites/${site.id}`} className="button" style={{ background: "none", color: "var(--accent)" }}>
          Back to site
        </Link>
      </div>

      {updated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Saved.
        </article>
      ) : null}
      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {error}
        </article>
      ) : null}

      <div className="card" style={{ marginBottom: 20, maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>Destination</h2>
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 14px" }}>
          {resolvedDestination ? (
            <>
              Currently resolves to <code style={{ wordBreak: "break-all" }}>{resolvedDestination}</code> — as of this
              site&apos;s last Deploy.
            </>
          ) : (
            "Nothing configured yet — cloaked CTAs won't redirect anywhere until something is set here or as a country default, and the site is deployed."
          )}
        </p>
        <form method="post" action={`/api/sites/${site.id}/affiliate-link`} style={{ display: "grid", gap: 8 }}>
          <label htmlFor="affiliateLinkOverride">This site&apos;s own link (optional)</label>
          <input
            type="text"
            id="affiliateLinkOverride"
            name="affiliateLinkOverride"
            defaultValue={site.metadata.affiliateLinkOverride ?? ""}
            placeholder="https://example.com/this-sites-offer"
          />
          <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
            Leave empty to use the{" "}
            <Link href="/integrations" style={{ color: "var(--accent)" }}>
              country-level default
            </Link>{" "}
            for {site.metadata.country || "this site's country"} instead. Baked directly into the site&apos;s own
            files at Deploy time — never looked up from a live visitor&apos;s browser — so this takes effect on the
            site&apos;s <strong>next Deploy</strong>, not instantly.
          </p>
          <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 4 }}>
            Save
          </button>
        </form>
      </div>

      <AffiliateCtaTools siteId={site.id} taggedLinks={taggedLinks} unmarkedLinks={unmarkedLinks} />
    </>
  );
}
