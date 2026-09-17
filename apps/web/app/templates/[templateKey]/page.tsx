import Link from "next/link";
import { notFound } from "next/navigation";
import { runtime } from "../../../lib/runtime";
import { PreviewFrame } from "../../PreviewFrame";

export default async function TemplateDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ templateKey: string }>;
  searchParams: Promise<{ error?: string; uploaded?: string }>;
}) {
  const { templateKey } = await params;
  const { error, uploaded } = await searchParams;

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
              <button className="button" type="submit" style={{ background: "none", color: "var(--warn)", borderColor: "var(--warn)" }}>
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
    </>
  );
}
