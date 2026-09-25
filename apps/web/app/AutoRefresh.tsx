"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Renders nothing — just re-fetches the current server-rendered page on an interval, so a page showing
 * live progress (an import run, a sync in progress) updates on its own instead of needing a manual reload.
 * Mount conditionally (only while something is actually in progress) so idle pages never poll. */
export function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
