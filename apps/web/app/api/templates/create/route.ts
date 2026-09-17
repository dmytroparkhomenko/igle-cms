import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../lib/runtime";
import { requireActor , resolveRequestOrigin} from "../../../../lib/session";

export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  let templateKey = "";

  try {
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const slugInput = String(form.get("slug") ?? "").trim();
    const domain = String(form.get("domain") ?? "").trim();
    templateKey = String(form.get("templateKey") ?? "").trim();

    if (!name) throw new IgleError("VALIDATION_ERROR", "Site name is required.", 400);
    if (!templateKey) throw new IgleError("VALIDATION_ERROR", "Template is required.", 400);

    const slug = slugify(slugInput || name);
    const actor = await requireActor();
    const site = await runtime.templateService.createSite({ name, slug, templateKey }, actor);

    if (domain) {
      await runtime.siteService.updateSettings(site, { domain, https: true, deploymentTarget: "aapanel" }, actor);
    }

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/sites/${site.id}`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ site }, { status: 201 });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      const backTo = templateKey ? `/templates/${templateKey}` : "/templates";
      return NextResponse.redirect(
        new URL(`${backTo}?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `site-${Date.now().toString(36)}`;
}
