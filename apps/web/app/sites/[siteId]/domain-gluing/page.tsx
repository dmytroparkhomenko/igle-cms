import Link from "next/link";
import { notFound } from "next/navigation";
import { runtime } from "../../../../lib/runtime";
import { requireActorOrRedirect } from "../../../../lib/session";

export default async function DomainGluingPage({
  params,
  searchParams
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ updated?: string; settingsError?: string }>;
}) {
  const { siteId } = await params;
  const { updated, settingsError } = await searchParams;
  const actor = await requireActorOrRedirect();
  const site = await runtime.siteService.get(siteId, actor);
  if (!site) notFound();

  return (
    <>
      <p style={{ marginTop: 0, marginBottom: 14 }}>
        <Link href={`/sites/${site.id}`}>&larr; Back to {site.metadata.name}</Link>
      </p>
      <div className="toolbar">
        <div>
          <h1>Domain gluing</h1>
          <p className="muted">
            For consolidating an aged/dropped domain into a newly-registered replacement. Every page without its
            own explicit canonical (set on that page&apos;s SEO fields) gets this target at build time instead of a
            self-referencing one. A niche, rarely-needed setting — kept off the main Site settings page on purpose.
          </p>
        </div>
      </div>

      {updated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Saved.
        </article>
      ) : null}
      {settingsError ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {settingsError}
        </article>
      ) : null}

      <article className="card" style={{ maxWidth: 560 }}>
        <form method="post" action={`/api/sites/${site.id}/settings`} style={{ display: "grid", gap: 14 }}>
          <input type="hidden" name="returnTo" value={`/sites/${site.id}/domain-gluing`} />
          {/* The settings route treats a missing https field as "turn https off" — this form only
              ever touches canonicalDomain/hreflangTargets, so the site's current value is mirrored
              through unconditionally rather than risk silently flipping it on save. */}
          {site.metadata.https ? <input type="hidden" name="https" value="on" /> : null}

          <div className="field">
            <label htmlFor="canonicalDomain">Canonical target domain</label>
            <input
              type="text"
              id="canonicalDomain"
              name="canonicalDomain"
              defaultValue={site.metadata.canonicalDomain ?? ""}
              placeholder="https://newreg.example"
            />
          </div>
          <div className="field">
            <label htmlFor="hreflangTargets">Hreflang alternates</label>
            <textarea
              id="hreflangTargets"
              name="hreflangTargets"
              rows={6}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: "8px 10px",
                font: "inherit",
                color: "var(--text)",
                background: "var(--panel)"
              }}
              defaultValue={site.metadata.hreflangTargets.map((target) => `${target.lang} ${target.domain}`).join("\n")}
              placeholder={"One per line: lang domain\nes-MX https://es.example.com\nx-default https://example.com"}
            />
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 11.5 }}>
              Overrides the automatic mirror-partner hreflang when set. Leave empty to keep the automatic behavior.
            </p>
          </div>
          <button className="button" type="submit" style={{ justifySelf: "start" }}>
            Save
          </button>
        </form>
      </article>
    </>
  );
}
