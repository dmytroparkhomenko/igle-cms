"use client";

import { useState } from "react";

interface PageOption {
  id: string;
  internalName: string;
  route: string;
}

interface PageTypeOption {
  key: string;
  name: string;
  route: string;
}

export function AddPageButton({ siteId, pages, pageTypes }: { siteId: string; pages: PageOption[]; pageTypes: PageTypeOption[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="button" style={{ background: "none", color: "var(--accent)" }} onClick={() => setOpen(true)}>
        Add page
      </button>
    );
  }

  return (
    <div className="deploy-modal-backdrop" role="dialog" aria-modal="true" aria-label="Add page" onClick={() => setOpen(false)}>
      <div className="editor-info-modal" style={{ maxWidth: 480, width: "92vw" }} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <h3 style={{ margin: 0 }}>Add page</h3>
          <button type="button" className="button button-ghost" style={{ padding: "2px 6px" }} onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
          Either way, the new page's header and footer are synced to match the rest of the site automatically, and it's
          included in the sitemap by default.
        </p>

        {pageTypes.length > 0 ? (
          <form
            method="post"
            action={`/api/sites/${siteId}/pages/create`}
            style={{ display: "grid", gap: 8, marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}
          >
            <input type="hidden" name="mode" value="template" />
            <p className="settings-section-title" style={{ margin: 0 }}>
              From this site&apos;s template
            </p>
            <select name="pageTypeKey" required>
              {pageTypes.map((pageType) => (
                <option key={pageType.key} value={pageType.key}>
                  {pageType.name} ({pageType.route})
                </option>
              ))}
            </select>
            <button className="button" type="submit" style={{ justifySelf: "start" }}>
              Add from template
            </button>
          </form>
        ) : null}

        <form
          method="post"
          action={`/api/sites/${siteId}/pages/create`}
          style={{ display: "grid", gap: 8, marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}
        >
          <input type="hidden" name="mode" value="duplicate" />
          <p className="settings-section-title" style={{ margin: 0 }}>
            Duplicate an existing page
          </p>
          {pages.length > 0 ? (
            <>
              <select name="sourcePageId" required>
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.internalName} ({page.route})
                  </option>
                ))}
              </select>
              <label className="muted" style={{ fontSize: 12.5 }}>
                Name
              </label>
              <input type="text" name="internalName" placeholder="e.g. Best Casinos 2026" />
              <button className="button" type="submit" style={{ justifySelf: "start" }}>
                Duplicate
              </button>
            </>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              No existing pages to duplicate yet.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
