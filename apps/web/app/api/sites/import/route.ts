import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../lib/runtime";
import { requireActor } from "../../../../lib/session";

export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const slugInput = String(form.get("slug") ?? "").trim();
    const domain = String(form.get("domain") ?? "").trim();
    const file = form.get("file");

    if (!name) throw new IgleError("VALIDATION_ERROR", "Site name is required.", 400);
    if (!(file instanceof File) || file.size === 0) {
      throw new IgleError("VALIDATION_ERROR", "A .zip file is required.", 400);
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      throw new IgleError("VALIDATION_ERROR", "Only .zip files are accepted.", 400);
    }

    const slug = slugify(slugInput || name);
    const zipBuffer = Buffer.from(await file.arrayBuffer());

    const actor = await requireActor();
    const site = await runtime.siteService.createBlankSite({ name, slug }, actor);
    const { revisionNumber, report } = await runtime.importService.importZip(site, zipBuffer, actor);

    if (domain) {
      await runtime.siteService.updateSettings(site, { domain, https: true, deploymentTarget: "aapanel" }, actor);
    }

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/sites?imported=${encodeURIComponent(site.slug)}`, request.url), { status: 303 });
    }
    return NextResponse.json({ site, revisionNumber, report }, { status: 201 });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites?importError=${encodeURIComponent(formatted.body.error.message)}`, request.url),
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
