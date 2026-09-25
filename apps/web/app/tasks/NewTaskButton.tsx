"use client";

import { useEffect, useState } from "react";

interface Member {
  id: string;
  name?: string | undefined;
  email: string;
}

interface Site {
  id: string;
  metadata: { name: string };
}

export function NewTaskButton({ members, sites, actorId }: { members: Member[]; sites: Site[]; actorId: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button type="button" className="button" onClick={() => setOpen(true)}>
        + New task
      </button>

      {open ? (
        <div
          className="deploy-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="New task"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="editor-info-modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <h2 style={{ margin: 0 }}>New task</h2>
              <button
                type="button"
                className="button"
                style={{ background: "none", color: "var(--muted)", padding: "4px 8px" }}
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form method="post" action="/api/tasks" style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <label className="muted" htmlFor="title">
                Title
              </label>
              <input type="text" id="title" name="title" required autoFocus />

              <label className="muted" htmlFor="description">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={4}
                style={{ font: "inherit", padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
              />

              <label className="muted" htmlFor="assigneeId">
                Assign to
              </label>
              <select id="assigneeId" name="assigneeId" defaultValue={actorId}>
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name || member.email}
                  </option>
                ))}
              </select>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label className="muted" htmlFor="priority">
                    Priority
                  </label>
                  <select id="priority" name="priority" defaultValue="medium">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="muted" htmlFor="deadline">
                    Deadline (optional)
                  </label>
                  <input type="date" id="deadline" name="deadline" />
                </div>
              </div>

              <label className="muted" htmlFor="siteId">
                Site (optional)
              </label>
              <select id="siteId" name="siteId">
                <option value="">No specific site</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.metadata.name}
                  </option>
                ))}
              </select>

              <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 6 }}>
                Create task
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
