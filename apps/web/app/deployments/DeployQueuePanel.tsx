"use client";

import { useEffect, useState } from "react";

interface QueueEntry {
  id: string;
  siteId: string;
  siteName: string;
  actorEmail: string;
  status: "queued" | "running" | "done" | "failed";
  position?: number;
  estimatedStartInMs: number;
}

interface QueueSnapshot {
  entries: QueueEntry[];
  averageDurationMs: number;
}

function formatEta(ms: number): string {
  if (ms <= 1000) return "starting now";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `~${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `~${minutes}m` : `~${minutes}m ${seconds}s`;
}

/**
 * Live view of the process-wide deploy queue (see DeployQueueService) — every deploy across every
 * site shares one queue, since only one actually runs at a time. Renders nothing while the queue is
 * empty, so it stays invisible until it's actually relevant.
 */
export function DeployQueuePanel({ highlightSiteId }: { highlightSiteId?: string }) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | undefined>(undefined);

  useEffect(() => {
    const source = new EventSource("/api/deployments/queue");
    source.addEventListener("snapshot", (event) => {
      setSnapshot(JSON.parse((event as MessageEvent).data));
    });
    return () => source.close();
  }, []);

  const entries = snapshot?.entries ?? [];
  if (entries.length === 0) return null;

  const activeCount = entries.filter((entry) => entry.status === "queued" || entry.status === "running").length;

  return (
    <div className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10, background: "var(--panel-2, var(--panel))" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 13.5 }}>
          Deploy queue — {activeCount} deployment{activeCount === 1 ? "" : "s"} in progress
        </strong>
        <span className="muted" style={{ fontSize: 12 }}>
          Typical deploy: {formatEta(snapshot!.averageDurationMs)}
        </span>
      </div>
      {entries.map((entry) => (
        <div
          key={entry.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 13,
            padding: "6px 10px",
            borderRadius: 6,
            background: entry.siteId === highlightSiteId ? "var(--accent-10, rgba(99,102,241,0.1))" : "transparent"
          }}
        >
          <span>
            <strong>{entry.siteName}</strong> <span className="muted">· {entry.actorEmail}</span>
          </span>
          <span className="muted">
            {entry.status === "running"
              ? "deploying now"
              : entry.status === "queued"
                ? `queued · position ${entry.position} · ${formatEta(entry.estimatedStartInMs)}`
                : entry.status === "done"
                  ? "done"
                  : "failed"}
          </span>
        </div>
      ))}
    </div>
  );
}
