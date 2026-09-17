"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * A link to the preview server. `originFallback` is the server-baked PREVIEW_ORIGIN (correct
 * only when the browser happens to be on the same machine as the Docker host) — corrected on
 * mount to the browser's own hostname, same port, so the link works from wherever the app is
 * actually being accessed. See VisualEditorClient.tsx for the fuller explanation.
 */
export function PreviewLink({
  originFallback,
  path,
  children,
  className,
  style
}: {
  originFallback: string;
  path: string;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [origin, setOrigin] = useState(originFallback);
  useEffect(() => {
    try {
      const port = new URL(originFallback).port || "3001";
      setOrigin(`${window.location.protocol}//${window.location.hostname}:${port}`);
    } catch {
      // Malformed fallback — keep using it as-is.
    }
  }, [originFallback]);

  return (
    <a href={`${origin}${path}`} target="_blank" rel="noreferrer" className={className} style={style}>
      {children}
    </a>
  );
}
