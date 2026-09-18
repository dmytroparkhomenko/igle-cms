import Link from "next/link";
import { runtime } from "../../lib/runtime";

export default async function TemplatesPage() {
  const templates = await runtime.templateService.list();

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Templates</h1>
          <p className="muted">{templates.length} available.</p>
        </div>
        <Link href="/templates/upload" className="button">
          Upload template
        </Link>
      </div>

      <div className="template-gallery">
        {templates.map((template) => (
          <Link key={template.key} href={`/templates/${template.key}`} className="card card-link template-card">
            <div className="template-thumb">
              <iframe src={`/api/templates/${template.key}/preview`} title={`${template.name} preview`} tabIndex={-1} />
            </div>
            <div className="template-card-body">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 15.5 }}>{template.name}</h2>
                {template.source === "custom" ? <span className="status">Uploaded</span> : null}
              </div>
              {template.description ? (
                <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                  {template.description}
                </p>
              ) : null}
              <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                {template.pageCount} starter page{template.pageCount === 1 ? "" : "s"} · v{template.version}
              </p>
            </div>
          </Link>
        ))}
        {templates.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              No templates found under <code>templates/</code>.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
