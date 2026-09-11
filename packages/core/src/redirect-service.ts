import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertCan, redirectsMetadataSchema, type Actor } from "@igle/shared";
import { readJson, writeJson } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import type { SiteRecord } from "./types.js";

export interface RedirectInput {
  from: string;
  to: string;
  status: "301" | "302";
}

export class RedirectService {
  constructor(private readonly revisionService: RevisionService) {}

  async addRedirect(site: SiteRecord, input: RedirectInput, actor: Actor): Promise<{ revisionNumber: number; redirectId: string }> {
    assertCan(actor, "integrations.configure", site.id);
    validateRedirect(input);
    const filePath = path.join(site.repoPath, ".igle", "redirects.json");
    const metadata = redirectsMetadataSchema.parse(await readJson(filePath));
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
}

function validateRedirect(input: RedirectInput): void {
  if (!input.from.startsWith("/") || input.from.includes("\n") || input.from.includes(";")) {
    throw new Error("Redirect source must be a safe internal route.");
  }
  if (!(input.to.startsWith("/") || /^https?:\/\//i.test(input.to)) || input.to.includes("\n") || input.to.includes(";")) {
    throw new Error("Redirect target must be a safe route or URL.");
  }
}

function validateNoLoopsOrChains(redirects: RedirectInput[]): void {
  const map = new Map(redirects.map((redirect) => [redirect.from, redirect.to]));
  for (const redirect of redirects) {
    if (redirect.from === redirect.to) throw new Error("Redirect loops are not allowed.");
    const next = map.get(redirect.to);
    if (next) throw new Error(`Redirect chains longer than one hop are not allowed: ${redirect.from} -> ${redirect.to} -> ${next}`);
  }
}
