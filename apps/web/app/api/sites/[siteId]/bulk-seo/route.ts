import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import type { BulkSeoRow } from "@igle/core";
import { runtime } from "../../../../../lib/runtime";
import { requireActor } from "../../../../../lib/session";

const FIELD_PATTERN = /^(seoTitle|metaDescription|h1)\[(.+)\]$/;

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId } = await context.params;

  try {
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const rowsByPageId = new Map<string, BulkSeoRow>();
    for (const [key, value] of form.entries()) {
      const match = FIELD_PATTERN.exec(key);
      if (!match) continue;
      const [, field, pageId] = match;
      if (!field || !pageId) continue;
      const row = rowsByPageId.get(pageId) ?? { pageId };
      row[field as "seoTitle" | "metaDescription" | "h1"] = String(value);
      rowsByPageId.set(pageId, row);
    }

    const fillEmptyOnly = form.get("fillEmptyOnly") === "on";
    const result = await runtime.seoService.bulkUpdateFields(site, [...rowsByPageId.values()], (await requireActor()), { fillEmptyOnly });

    if (wantsRedirect) {
      const url = new URL(`/sites/${site.id}/bulk-seo`, request.url);
      url.searchParams.set("updated", String(result.revisionNumber));
      url.searchParams.set("skipped", String(result.skipped.length));
      return NextResponse.redirect(url, { status: 303 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}/bulk-seo?error=${encodeURIComponent(formatted.body.error.message)}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
