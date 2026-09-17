import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { scriptPresets } from "@igle/core";
import { runtime } from "../../../../../../lib/runtime";
import { requireActor , resolveRequestOrigin} from "../../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId } = await context.params;

  try {
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const type = String(form.get("type") ?? "");
    const trackingId = String(form.get("id") ?? "").trim();
    if (!trackingId) throw new IgleError("INVALID_TRACKING_ID", "A tracking ID is required.", 400);

    let name: string;
    let code: string;
    if (type === "ga4") {
      if (!/^G-[A-Z0-9]+$/i.test(trackingId)) throw new IgleError("INVALID_TRACKING_ID", "GA4 measurement IDs look like G-XXXXXXXXXX.", 400);
      name = `Google Analytics 4 (${trackingId})`;
      code = scriptPresets.gaPreset(trackingId);
    } else if (type === "gtm") {
      if (!/^GTM-[A-Z0-9]+$/i.test(trackingId)) throw new IgleError("INVALID_TRACKING_ID", "GTM container IDs look like GTM-XXXXXXX.", 400);
      name = `Google Tag Manager (${trackingId})`;
      code = scriptPresets.gtmPreset(trackingId);
    } else {
      throw new IgleError("INVALID_PRESET", "Unknown script preset.", 400);
    }

    await runtime.scriptService.addScript(
      site,
      { name, code, placement: "head-start", environment: "production" },
      (await requireActor())
    );

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/sites/${site.id}/scripts?added=1`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}/scripts?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
