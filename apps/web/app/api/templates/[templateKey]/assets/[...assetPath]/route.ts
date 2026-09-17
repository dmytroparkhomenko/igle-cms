import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { normalizeSitePath, resolveInside } from "@igle/shared";
import { runtime } from "../../../../../../lib/runtime";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

export async function GET(_request: Request, context: { params: Promise<{ templateKey: string; assetPath: string[] }> }) {
  const { templateKey, assetPath } = await context.params;

  try {
    const relative = normalizeSitePath(assetPath.join("/"));
    const assetsDir = await runtime.templateService.assetsDirFor(templateKey);
    const absolutePath = resolveInside(assetsDir, relative);
    const content = await fs.readFile(absolutePath);
    const contentType = contentTypes[path.extname(absolutePath).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(content, {
      status: 200,
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=300" }
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
