import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertCan, IgleError, redirectsMetadataSchema, type Actor } from "@igle/shared";
import { readJson, writeJson } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import type { SiteRecord } from "./types.js";

export interface RedirectInput {
  from: string;
  to: string;
  status: "301" | "302";
}

export interface RedirectRecord extends RedirectInput {
  id: string;
}

export class RedirectService {
  constructor(private readonly revisionService: RevisionService) {}

  async list(site: SiteRecord): Promise<RedirectRecord[]> {
    const filePath = path.join(site.repoPath, ".igle", "redirects.json");
    const metadata = redirectsMetadataSchema.parse(await readJson(filePath).catch(() => ({ redirects: [] })));
    return metadata.redirects;
  }

  async addRedirect(site: SiteRecord, input: RedirectInput, actor: Actor): Promise<{ revisionNumber: number; redirectId: string }> {
    assertCan(actor, "sites.integrations", site.id);
    validateRedirect(input);
    const filePath = path.join(site.repoPath, ".igle", "redirects.json");
    const metadata = redirectsMetadataSchema.parse(await readJson(filePath).catch(() => ({ redirects: [] })));
    const redirects = [...metadata.redirects, { id: `redirect_${randomUUID().replaceAll("-", "")}`, ...input }];
    validateNoLoopsOrChains(redirects);
    await writeJson(filePath, { redirects });
    const revision = await this.revisionService.commitRevision({
      site,
      source: "redirect",
      title: `Added redirect ${input.from} to ${input.to}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });
    return { revisionNumber: revision.revisionNumber, redirectId: redirects.at(-1)!.id };
  }

  async deleteRedirect(site: SiteRecord, redirectId: string, actor: Actor): Promise<{ revisionNumber: number }> {
    assertCan(actor, "sites.integrations", site.id);
    const filePath = path.join(site.repoPath, ".igle", "redirects.json");
    const metadata = redirectsMetadataSchema.parse(await readJson(filePath).catch(() => ({ redirects: [] })));
    const existing = metadata.redirects.find((redirect) => redirect.id === redirectId);
    if (!existing) throw new IgleError("REDIRECT_NOT_FOUND", "Redirect was not found.", 404);
    const redirects = metadata.redirects.filter((redirect) => redirect.id !== redirectId);
    await writeJson(filePath, { redirects });
    const revision = await this.revisionService.commitRevision({
      site,
      source: "redirect",
      title: `Removed redirect ${existing.from} to ${existing.to}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });
    return { revisionNumber: revision.revisionNumber };
  }
}

function validateRedirect(input: RedirectInput): void {
  if (!input.from.startsWith("/") || input.from.includes("\n") || input.from.includes(";")) {
    throw new IgleError("INVALID_REDIRECT", "Redirect source must be a safe internal route.", 400);
  }
  if (!(input.to.startsWith("/") || /^https?:\/\//i.test(input.to)) || input.to.includes("\n") || input.to.includes(";")) {
    throw new IgleError("INVALID_REDIRECT", "Redirect target must be a safe route or URL.", 400);
  }
}

function validateNoLoopsOrChains(redirects: RedirectInput[]): void {
  const map = new Map(redirects.map((redirect) => [redirect.from, redirect.to]));
  for (const redirect of redirects) {
    if (redirect.from === redirect.to) throw new IgleError("REDIRECT_LOOP", "Redirect loops are not allowed.", 400);
    const next = map.get(redirect.to);
    if (next) {
      throw new IgleError(
        "REDIRECT_CHAIN",
        `Redirect chains longer than one hop are not allowed: ${redirect.from} -> ${redirect.to} -> ${next}`,
        400
      );
    }
  }
}
