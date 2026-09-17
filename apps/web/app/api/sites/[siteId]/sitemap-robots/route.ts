import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { requireActor } from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId } = await context.params;

  try {
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const robotsMode = form.get("robotsMode") === "manual" ? "manual" : "cms-generated";
    const robotsContent = String(form.get("robotsContent") ?? "");
    const sitemapEnabled = form.get("sitemapEnabled") === "on";
    const metaRobots = form.get("metaRobots") === "noindex" ? "noindex" : "index";

    await runtime.siteService.updateSitemapAndRobots(site, { sitemapEnabled, robotsMode, robotsContent, metaRobots }, (await requireActor()));

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/sites/${site.id}?updated=1`, request.url), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}?settingsError=${encodeURIComponent(formatted.body.error.message)}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
