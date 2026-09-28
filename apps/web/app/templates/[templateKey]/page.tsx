import Link from "next/link";
import { notFound } from "next/navigation";
import { runtime } from "../../../lib/runtime";
import { PreviewFrame } from "../../PreviewFrame";

export default async function TemplateDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ templateKey: string }>;
  searchParams: Promise<{ error?: string; uploaded?: string; updated?: string }>;
}) {
  const { templateKey } = await params;
  const { error, uploaded, updated } = await searchParams;

  const templates = await runtime.templateService.list();
  const template = templates.find((item) => item.key === templateKey);
  if (!template) notFound();

  return (
    <>
      <div className="toolbar">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h1 style={{ margin: 0 }}>{template.name}</h1>
            {template.source === "custom" ? <span className="status">Uploaded</span> : null}
          </div>
          <p className="muted">
            {template.pageCount} starter page{template.pageCount === 1 ? "" : "s"} · v{template.version}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {template.source === "custom" ? (
            <form method="post" action={`/api/templates/${template.key}/delete`}>
              <button className="button button-danger" type="submit">
                Delete template
              </button>
            </form>
          ) : null}
          <Link href="/templates" className="button" style={{ background: "none", color: "var(--accent)" }}>
            All templates
          </Link>
        </div>
      </div>

      {template.description ? <p className="muted" style={{ marginTop: -8 }}>{template.description}</p> : null}

      {uploaded ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Template uploaded and converted. Review the preview below, then launch a site from it.
        </article>
      ) : null}
      {updated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Template updated. Sites already launched from it are untouched — only new launches use the new files.
        </article>
      ) : null}
      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {error}
        </article>
      ) : null}

      <div className="template-detail-layout">
        <PreviewFrame
          className="template-preview-frame"
          src={`/api/templates/${template.key}/preview`}
          title={`${template.name} preview`}
        />

        <form className="card" method="post" action="/api/templates/create" style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="templateKey" value={template.key} />
          <h2 style={{ margin: 0, fontSize: 15 }}>Launch a site from this template</h2>

          <label className="muted" htmlFor="name">
            Site name
          </label>
          <input type="text" id="name" name="name" required />

          <label className="muted" htmlFor="domain">
            Domain (optional)
          </label>
          <input type="text" id="domain" name="domain" placeholder="example.com" />
          <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
            Assign a server for it in Site Settings after launch, then deploy.
          </p>

          <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 6 }}>
            Launch site
          </button>
        </form>
      </div>

      {template.source === "custom" ? (
        <details className="card" style={{ marginTop: 20, maxWidth: 560 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Update this template&apos;s files</summary>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            Upload a new .zip to replace this template&apos;s pages and assets in place — the link/key everything
            points to stays the same. Sites already launched from this template are untouched; each copied its own
            files at launch time and has no ongoing connection to the template.
          </p>
          <form
            method="post"
            action={`/api/templates/${template.key}/update`}
            encType="multipart/form-data"
            style={{ display: "grid", gap: 10, marginTop: 10 }}
          >
            <div className="field">
              <label htmlFor="update-name">Template name</label>
              <input type="text" id="update-name" name="name" required defaultValue={template.name} />
            </div>
            <div className="field">
              <label htmlFor="update-description">Description (optional)</label>
              <textarea id="update-description" name="description" rows={2} style={textareaStyle} defaultValue={template.description ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="update-sourceDomain">Source domain (optional)</label>
              <input type="text" id="update-sourceDomain" name="sourceDomain" placeholder="example.com" />
            </div>
            <div className="field">
              <label htmlFor="update-brandName">Brand/product name to parameterize (optional)</label>
              <input type="text" id="update-brandName" name="brandName" placeholder="e.g. the product or company name used throughout the site" />
            </div>
            <div className="field">
              <label htmlFor="update-file">New site .zip file</label>
              <input type="file" id="update-file" name="file" accept=".zip" required />
            </div>
            <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 4 }}>
              Replace template files
            </button>
          </form>
        </details>
      ) : null}
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
