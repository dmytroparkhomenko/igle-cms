import { IgleError } from "@igle/shared";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";

export default async function IntegrationsPage({
  searchParams
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const actor = await requireActorOrRedirect();
  const { updated, error } = await searchParams;

  let affiliateLinks: Record<string, string> = {};
  let forbidden = false;
  try {
    affiliateLinks = await runtime.affiliateLinkService.list(actor);
  } catch (err) {
    if (err instanceof IgleError && err.code === "FORBIDDEN") forbidden = true;
    else throw err;
  }

  return (
    <>
      <h1>Integrations</h1>

      {forbidden ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>Only administrators can configure affiliate links.</p>
        </section>
      ) : (
        <>
          {updated ? (
            <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 480 }}>
              Saved.
            </article>
          ) : null}
          {error ? (
            <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16, maxWidth: 480 }}>
              {error}
            </article>
          ) : null}

          <div className="settings-card" style={{ maxWidth: 480 }}>
            <div className="settings-card-header">
              <h2>Affiliate links</h2>
            </div>
            <div style={{ padding: "0 20px 16px", margin: 0 }}>
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                Where traffic goes, per country. Stored only — nothing on the sites reads or applies these yet.
              </p>
            </div>
            <form method="post" action="/api/integrations/affiliate-links">
              <div className="settings-section" style={{ paddingTop: 0, borderTop: "none" }}>
                <div className="field">
                  <label htmlFor="url-br">Brazil (BR)</label>
                  <input type="hidden" name="country" value="BR" />
                  <input type="text" id="url-br" name="url" defaultValue={affiliateLinks.BR ?? ""} placeholder="https://example.com/br-offer" />
                </div>
              </div>
              <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 4 }}>
                Save Brazil link
              </button>
            </form>
            <form method="post" action="/api/integrations/affiliate-links">
              <div className="settings-section">
                <div className="field">
                  <label htmlFor="url-mx">Mexico (MX)</label>
                  <input type="hidden" name="country" value="MX" />
                  <input type="text" id="url-mx" name="url" defaultValue={affiliateLinks.MX ?? ""} placeholder="https://example.com/mx-offer" />
                </div>
              </div>
              <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 4 }}>
                Save Mexico link
              </button>
            </form>
          </div>
        </>
      )}
    </>
  );
}
