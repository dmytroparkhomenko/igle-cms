"use client";

import { useState } from "react";

export function DeleteSiteButton({
  siteId,
  slug,
  label,
  redirectTo = "/sites/duplicates"
}: {
  siteId: string;
  slug: string;
  label: string;
  redirectTo?: string;
}) {
  const [pending, setPending] = useState(false);

  async function remove() {
    if (!window.confirm(`Permanently delete "${label}" (${slug})? This removes its files and full revision history — it can't be undone.`)) {
      return;
    }
    setPending(true);
    try {
      const form = new FormData();
      form.set("confirmSlug", slug);
      const response = await fetch(`/api/sites/${siteId}/delete`, { method: "POST", headers: { Accept: "application/json" }, body: form });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined);
        window.alert(body?.error?.message ?? "Failed to delete site.");
        setPending(false);
        return;
      }
      window.location.href = redirectTo;
    } catch {
      window.alert("Failed to delete site.");
      setPending(false);
    }
  }

  return (
    <button type="button" className="button button-danger" onClick={remove} disabled={pending} style={{ fontSize: 12.5 }}>
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
