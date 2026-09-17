import { NextResponse } from "next/server";
import { runtime } from "../../../../../lib/runtime";

export async function GET(_request: Request, context: { params: Promise<{ templateKey: string }> }) {
  const { templateKey } = await context.params;

  try {
    const html = await runtime.templateService.renderPreview(templateKey);
    const templateBase = `/api/templates/${templateKey}/`;
    // Site templates commonly mix root-absolute asset refs ("/assets/x.png") with relative ones
    // ("assets/x.css"). Both are relative to the template's own root folder on disk, so strip the
    // leading "/" to make absolute refs relative too, then let the <base> tag below resolve all
    // of them the same way. Same trick apps/preview already uses for real site previews.
    const rewritten = html.replace(/(\s(?:src|href)=")\/(?!\/)([^"]*)(")/gi, `$1$2$3`);
    const withBase = rewritten.replace(/<head[^>]*>/i, (match) => `${match}<base href="${templateBase}">`);

    return new NextResponse(withBase, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  } catch {
    return new NextResponse("<!doctype html><p>Preview not available.</p>", {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
}
