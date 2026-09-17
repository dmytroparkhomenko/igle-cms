import fs from "node:fs/promises";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveInside } from "@igle/shared";
import { runtime } from "../../../../../../lib/runtime";
import { requireActorOrRedirect } from "../../../../../../lib/session";

export default async function CodeEditor({
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

  const content = await fs.readFile(resolveInside(site.repoPath, page.filePath), "utf8");

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Code — {page.internalName}</h1>
          <p className="muted">{page.filePath}</p>
        </div>
        <Link href={`/sites/${site.id}/pages/${page.id}`} className="button" style={{ background: "none", color: "var(--accent)" }}>
          Back to fields
        </Link>
      </div>

      <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
        Direct source changes can override structured CMS settings. Igle CMS re-indexes this file after
        saving and creates a new revision; any field that no longer matches what the CMS last wrote becomes
        <strong> Manual Source</strong>.
      </article>

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

      <form method="post" action={`/api/sites/${site.id}/pages/${page.id}/source`}>
        <textarea
          name="content"
          defaultValue={content}
          spellCheck={false}
          rows={32}
          style={{
            width: "100%",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--text)",
            background: "var(--panel)",
            resize: "vertical",
            tabSize: 2
          }}
        />
        <div style={{ marginTop: 12 }}>
          <button className="button" type="submit">
            Save source
          </button>
        </div>
      </form>
    </>
  );
}
