import Link from "next/link";
import type { PageIndexRecord } from "@igle/core";

export function PageRow({ siteId, page }: { siteId: string; page: PageIndexRecord }) {
  return (
    <div className="list-row">
      <Link href={`/sites/${siteId}/pages/${page.id}`} className="main" style={{ textDecoration: "none", color: "inherit" }}>
        <h3>{page.internalName}</h3>
        <p className="muted">{page.route}</p>
      </Link>
      <div className="side muted">{page.seoTitle ? page.seoTitle : "No title"}</div>
      <form method="post" action={`/api/sites/${siteId}/pages/${page.id}/duplicate`}>
        <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", fontSize: 12.5, padding: "6px 10px" }}>
          Duplicate
        </button>
      </form>
      <form method="post" action={`/api/sites/${siteId}/pages/${page.id}/delete`}>
        <button className="button" type="submit" style={{ background: "none", color: "var(--warn)", fontSize: 12.5, padding: "6px 10px" }}>
          Delete
        </button>
      </form>
    </div>
  );
}
