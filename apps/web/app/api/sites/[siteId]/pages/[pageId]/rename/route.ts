import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../../../lib/runtime";
import { requireActor , resolveRequestOrigin} from "../../../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string; pageId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId, pageId } = await context.params;

  try {
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const newFilePath = String(form.get("filePath") ?? "");
    const addRedirect = form.get("addRedirect") === "on";

    const result = await runtime.seoService.renamePage(site, pageId, newFilePath, { addRedirect }, (await requireActor()));

    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${site.id}/pages/${result.page.id}?updated=${result.revisionNumber}`, resolveRequestOrigin(request)),
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
