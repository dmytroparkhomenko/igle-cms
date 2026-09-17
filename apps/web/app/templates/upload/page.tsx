import Link from "next/link";

export default async function UploadTemplatePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Upload a template</h1>
          <p className="muted">Package a static HTML site as a reusable template for launching new sites.</p>
        </div>
        <Link href="/templates" className="button" style={{ background: "none", color: "var(--accent)" }}>
          All templates
        </Link>
      </div>

      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16, maxWidth: 640 }}>
          {error}
        </article>
      ) : null}

      <form
        className="card"
        method="post"
        action="/api/templates/upload"
        encType="multipart/form-data"
        style={{ display: "grid", gap: 14, maxWidth: 560 }}
      >
        <div className="field">
          <label htmlFor="name">Template name</label>
          <input type="text" id="name" name="name" required placeholder="e.g. Local Business Starter" />
        </div>

        <div className="field">
          <label htmlFor="description">Description (optional)</label>
          <textarea id="description" name="description" rows={2} style={textareaStyle} placeholder="What kind of site is this, and what's included" />
        </div>

        <div className="field">
          <label htmlFor="sourceDomain">Source domain (optional)</label>
          <input type="text" id="sourceDomain" name="sourceDomain" placeholder="example.com" />
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 11.5 }}>
            If the uploaded site references its own domain (canonical links, or mentions of it in legal/about copy),
            enter it here to strip it — links become relative and self-mentions become the new site&apos;s own name.
          </p>
        </div>

        <div className="field">
          <label htmlFor="brandName">Brand/product name to parameterize (optional)</label>
          <input type="text" id="brandName" name="brandName" placeholder="e.g. the product or company name used throughout the site" />
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 11.5 }}>
            Every occurrence becomes an editable field on each page, instead of staying fixed text.
          </p>
        </div>

        <div className="field">
          <label htmlFor="file">Site .zip file</label>
          <input type="file" id="file" name="file" accept=".zip" required />
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 11.5 }}>
            Any number of .html files at any folder depth, plus their CSS/JS/image assets. Internal links and asset
            references are rewritten automatically to work regardless of the original folder layout.
          </p>
        </div>

        <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 4 }}>
          Upload and convert
        </button>
      </form>
    </>
  );
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
