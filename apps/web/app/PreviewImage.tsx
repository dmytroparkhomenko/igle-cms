"use client";

import { useEffect, useState, type CSSProperties } from "react";

/**
 * An <img> served from the preview server. `originFallback` is the server-baked PREVIEW_ORIGIN
 * (correct only when the browser happens to be on the same machine as the Docker host) —
 * corrected on mount to the browser's own hostname, same port, so the thumbnail actually loads
 * wherever the app is being accessed from. Same fix as PreviewLink, for <img> instead of <a>.
 */
export function PreviewImage({
  originFallback,
  path,
  alt,
  className,
  style,
  width,
  height,
  loading
}: {
  originFallback: string;
  path: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  width?: number;
  height?: number;
  loading?: "lazy" | "eager";
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

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`${origin}${path}`} alt={alt} className={className} style={style} width={width} height={height} loading={loading} />;
}
