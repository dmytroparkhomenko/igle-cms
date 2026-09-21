import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import type { UpdateSiteSettingsInput } from "@igle/core";
import { runtime } from "../../../../../lib/runtime";
import { requireActor , resolveRequestOrigin} from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId } = await context.params;

  try {
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const urlStyle = String(form.get("urlStyle") ?? "");
    const wwwMode = String(form.get("wwwMode") ?? "");

    const settings: UpdateSiteSettingsInput = {
      name: String(form.get("name") ?? ""),
      // Domain is deliberately not settable here — every domain must go through Cloudflare
      // (see DomainService.assignToSite), so this form no longer has a domain field at all.
      https: form.get("https") === "on"
    };
    if (urlStyle === "html-ext" || urlStyle === "clean" || urlStyle === "clean-slash") settings.urlStyle = urlStyle;
    if (wwwMode === "www" || wwwMode === "non-www") settings.wwwMode = wwwMode;
    const language = form.get("language");
    if (language) settings.language = String(language);
    const country = form.get("country");
    if (country) settings.country = String(country);
    const category = String(form.get("category") ?? "");
    if (category === "affiliate" || category === "pbn") settings.category = category;
    const deploymentTarget = String(form.get("deploymentTarget") ?? "");
    if (deploymentTarget === "local" || deploymentTarget === "aapanel") settings.deploymentTarget = deploymentTarget;
    const serverIdRaw = form.get("serverId");
    if (serverIdRaw !== null) settings.serverId = String(serverIdRaw);

    await runtime.siteService.updateSettings(site, settings, (await requireActor()));

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/sites/${site.id}?updated=1`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}?settingsError=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
