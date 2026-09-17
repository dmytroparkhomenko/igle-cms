import { NextResponse } from "next/server";
import { apiError, effectiveSiteLanguageTag, IgleError } from "@igle/shared";
import type { UpdatePageFieldsInput } from "@igle/core";
import { runtime } from "../../../../../../../lib/runtime";
import { requireActor , resolveRequestOrigin} from "../../../../../../../lib/session";

export async function PATCH(request: Request, context: { params: Promise<{ siteId: string; pageId: string }> }) {
  try {
    const { siteId, pageId } = await context.params;
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);
    const body = (await request.json()) as { seoTitle?: string; metaDescription?: string; h1?: string };
    const result = await runtime.seoService.updateFields(site, pageId, body, (await requireActor()));
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}

export async function POST(request: Request, context: { params: Promise<{ siteId: string; pageId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId, pageId } = await context.params;

  try {
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const fields: UpdatePageFieldsInput = {};
    if (form.has("seoTitle")) fields.seoTitle = String(form.get("seoTitle"));
    if (form.has("metaDescription")) fields.metaDescription = String(form.get("metaDescription"));
    if (form.has("h1")) fields.h1 = String(form.get("h1"));

    if (form.has("canonical")) fields.canonical = emptyToNull(String(form.get("canonical")));
    if (form.has("ogTitle")) fields.ogTitle = emptyToNull(String(form.get("ogTitle")));
    if (form.has("ogDescription")) fields.ogDescription = emptyToNull(String(form.get("ogDescription")));

    // A submitted "expertFormSubmitted" sentinel means this POST came from the Additional
    // SEO Settings form, where its checkboxes are authoritative (an unchecked checkbox is
    // simply absent from form data, so presence alone can't tell "false" from "not this form").
    if (form.has("expertFormSubmitted")) {
      const noindex = form.get("noindex") === "on";
      const nofollow = form.get("nofollow") === "on";
      fields.robots = `${noindex ? "noindex" : "index"}, ${nofollow ? "nofollow" : "follow"}`;
      fields.inSitemap = form.get("inSitemap") === "on";

      const langRaw = String(form.get("lang") ?? "").trim();
      // Blank, or set back to the site's own effective language (language, or
      // language-COUNTRY once a GEO is set), means "stop overriding" — go back to inherited.
      // Anything else is a deliberate per-page override.
      fields.lang = langRaw === "" || langRaw.toLowerCase() === effectiveSiteLanguageTag(site.metadata).toLowerCase() ? null : langRaw.toLowerCase();
    }

    const result = await runtime.seoService.updateFields(site, pageId, fields, (await requireActor()));

    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${site.id}/pages/${pageId}?updated=${result.revisionNumber}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}/pages/${pageId}?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}

function emptyToNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}
