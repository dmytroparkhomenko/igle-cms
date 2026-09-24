import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertCan, IgleError, type Actor } from "@igle/shared";
import { assertSiteEditable } from "./site-guard.js";
import type { SiteRecord } from "./types.js";

const allowedExtensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/avif": ".avif"
};
const maxBytes = 10 * 1024 * 1024;

export interface MediaUploadInput {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

export class MediaService {
  /** Writes an uploaded image into the site's repo root and returns its root-relative src path. Callers are responsible for committing a revision once they've also patched whatever references it. */
  async saveUpload(site: SiteRecord, input: MediaUploadInput, actor: Actor): Promise<{ path: string }> {
    assertCan(actor, "sites.edit", site.id);
    assertSiteEditable(site);
    const extension = allowedExtensions[input.mimeType];
    if (!extension) {
      throw new IgleError("UNSUPPORTED_MEDIA_TYPE", "Only JPG, PNG, WebP, GIF, SVG, and AVIF images are supported.", 415);
    }
    if (input.buffer.byteLength > maxBytes) {
      throw new IgleError("FILE_TOO_LARGE", "Images must be 10MB or smaller.", 413);
    }

    const safeName =
      path
        .basename(input.originalName, path.extname(input.originalName))
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "image";
    const filename = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}-${safeName}${extension}`;
    const relativePath = path.posix.join("media", filename);
    const destination = path.join(site.repoPath, "media", filename);

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, input.buffer);
    return { path: `/${relativePath}` };
  }
}
