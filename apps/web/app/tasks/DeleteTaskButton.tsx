"use client";

import { useState } from "react";

export function DeleteTaskButton({ taskId, title, redirectTo = "/tasks?deleted=1" }: { taskId: string; title: string; redirectTo?: string }) {
  const [pending, setPending] = useState(false);

  async function remove() {
    if (!window.confirm(`Permanently delete "${title}"? This removes its comments, attachments and activity for good — it can't be undone.`)) {
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/delete`, { method: "POST", headers: { Accept: "application/json" } });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined);
        window.alert(body?.error?.message ?? "Failed to delete task.");
        setPending(false);
        return;
      }
      window.location.href = redirectTo;
    } catch {
      window.alert("Failed to delete task.");
      setPending(false);
    }
  }

  return (
    <button type="button" className="button button-danger" onClick={remove} disabled={pending}>
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
