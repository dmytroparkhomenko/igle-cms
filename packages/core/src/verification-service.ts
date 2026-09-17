import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { assertCan, IgleError, resolveInside, verificationsMetadataSchema, type Actor } from "@igle/shared";
import { readJson, writeJson } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import type { SiteRecord } from "./types.js";

export type VerificationProvider = "google" | "bing";

export interface VerificationRecord {
  id: string;
  provider: VerificationProvider;
  filePath: string;
  contentHash: string;
}

const CODE_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

export class VerificationService {
  constructor(private readonly revisionService: RevisionService) {}

  async list(site: SiteRecord): Promise<VerificationRecord[]> {
    const metadata = await this.read(site);
    const records: VerificationRecord[] = [];
    for (const item of metadata.verifications) {
      if ((item.provider === "google" || item.provider === "bing") && item.filePath) {
        records.push({ id: item.id, provider: item.provider, filePath: item.filePath, contentHash: item.contentHash });
      }
    }
    return records;
  }

  /**
   * File-based verification only (the method the user asked for) — Google and Bing both
   * generate a fixed filename/content shape from a single "verification code" they show you,
   * so the only real input needed here is that code.
   */
  async add(site: SiteRecord, provider: VerificationProvider, code: string, actor: Actor): Promise<{ revisionNumber: number; verification: VerificationRecord }> {
    assertCan(actor, "integrations.configure", site.id);
    // Google shows the code as part of a full filename ("google<code>.html"), and it's natural
    // to paste that whole thing — strip a redundant "google" prefix and ".html" suffix so it
    // doesn't get doubled into "googlegoogle<code>.html" when we build the file ourselves below.
    let trimmed = code.trim();
    if (provider === "google") {
      trimmed = trimmed.replace(/\.html?$/i, "").replace(/^google/i, "");
    }
    if (!CODE_PATTERN.test(trimmed)) {
      throw new IgleError("INVALID_VERIFICATION_CODE", "That doesn't look like a verification code (letters, numbers, - and _ only, 8-64 characters).", 400);
    }

    const { filePath, content } = buildVerificationFile(provider, trimmed);
    const absolutePath = resolveInside(site.repoPath, filePath);
    await fs.writeFile(absolutePath, content, "utf8");

    const metadata = await this.read(site);
    metadata.verifications = metadata.verifications.filter((item) => item.filePath !== filePath);
    const verification: VerificationRecord = { id: `verify_${randomUUID().replaceAll("-", "")}`, provider, filePath, contentHash: hash(content) };
    metadata.verifications.push(verification);
    await this.write(site, metadata);

    const revision = await this.revisionService.commitRevision({
      site,
      source: "verification",
      title: `Added ${provider === "google" ? "Google Search Console" : "Bing Webmaster"} verification file`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    return { revisionNumber: revision.revisionNumber, verification };
  }

  async remove(site: SiteRecord, verificationId: string, actor: Actor): Promise<{ revisionNumber: number }> {
    assertCan(actor, "integrations.configure", site.id);
    const metadata = await this.read(site);
    const existing = metadata.verifications.find((item) => item.id === verificationId);
    if (!existing) throw new IgleError("VERIFICATION_NOT_FOUND", "Verification was not found.", 404);

    if (existing.filePath) {
      await fs.rm(resolveInside(site.repoPath, existing.filePath), { force: true });
    }
    metadata.verifications = metadata.verifications.filter((item) => item.id !== verificationId);
    await this.write(site, metadata);

    const revision = await this.revisionService.commitRevision({
      site,
      source: "verification",
      title: `Removed ${existing.provider} verification file`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    return { revisionNumber: revision.revisionNumber };
  }

  /** Fetches the verification file from the site's real, live domain to confirm it's actually reachable. */
  async checkReachable(site: SiteRecord, verification: VerificationRecord): Promise<{ ok: boolean; error?: string }> {
    if (!site.metadata.domain) return { ok: false, error: "Site has no domain configured yet." };
    const protocol = site.metadata.https ? "https" : "http";
    const url = `${protocol}://${site.metadata.domain}/${verification.filePath}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return { ok: false, error: `${url} returned HTTP ${response.status}.` };
      const text = await response.text();
      if (hash(text) !== verification.contentHash) return { ok: false, error: `${url} is reachable but its content doesn't match what was deployed.` };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Request failed." };
    }
  }

  private async read(site: SiteRecord) {
    const filePath = path.join(site.repoPath, ".igle", "verifications.json");
    return verificationsMetadataSchema.parse(await readJson(filePath).catch(() => ({ verifications: [] })));
  }

  private async write(site: SiteRecord, metadata: { verifications: unknown[] }): Promise<void> {
    const filePath = path.join(site.repoPath, ".igle", "verifications.json");
    await writeJson(filePath, metadata);
  }
}

function buildVerificationFile(provider: VerificationProvider, code: string): { filePath: string; content: string } {
  if (provider === "google") {
    return { filePath: `google${code}.html`, content: `google-site-verification: google${code}.html` };
  }
  return {
    filePath: "BingSiteAuth.xml",
    content: `<?xml version="1.0"?>\n<users>\n\t<user>${code}</user>\n</users>\n`
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
