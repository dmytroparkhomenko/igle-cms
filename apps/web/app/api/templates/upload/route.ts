import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../lib/runtime";
import { requireActor , resolveRequestOrigin} from "../../../../lib/session";

export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const sourceDomain = String(form.get("sourceDomain") ?? "").trim();
    const brandName = String(form.get("brandName") ?? "").trim();
    const file = form.get("file");

    if (!(file instanceof File) || file.size === 0) {
      throw new IgleError("VALIDATION_ERROR", "A .zip file is required.", 400);
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      throw new IgleError("VALIDATION_ERROR", "Only .zip files are accepted.", 400);
    }

    const zipBuffer = Buffer.from(await file.arrayBuffer());
    const { key, report } = await runtime.templateService.uploadTemplate(
      {
        name,
        description: description || undefined,
        sourceDomain: sourceDomain || undefined,
        brandName: brandName || undefined,
        zipBuffer
      },
      (await requireActor())
    );

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/templates/${key}?uploaded=1`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ key, report }, { status: 201 });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/templates/upload?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
