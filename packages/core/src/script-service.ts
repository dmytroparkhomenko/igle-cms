import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { assertCan, scriptsMetadataSchema, type Actor } from "@igle/shared";
import { readJson, writeJson } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import type { SiteRecord } from "./types.js";

export interface ScriptInput {
  name: string;
  code: string;
  placement: "head-start" | "head-end" | "body-start" | "body-end";
  environment: "preview" | "production" | "both";
  enabled?: boolean;
  pages?: { mode: "all" | "selected" | "patterns"; paths?: string[]; patterns?: string[] };
  owner?: string;
}

export class ScriptService {
  constructor(private readonly revisionService: RevisionService) {}

  async addScript(site: SiteRecord, input: ScriptInput, actor: Actor): Promise<{ revisionNumber: number; scriptId: string }> {
    assertCan(actor, "integrations.configure", site.id);
    const filePath = path.join(site.repoPath, ".igle", "scripts.json");
    const metadata = scriptsMetadataSchema.parse(await readJson(filePath));
    const hash = scriptHash(input.code);
    if (metadata.scripts.some((script) => scriptHash(script.code) === hash)) {
      throw new Error("A script with the same code is already configured.");
    }
    const trackingId = detectTrackingId(input.code);
    if (trackingId && metadata.scripts.some((script) => detectTrackingId(script.code) === trackingId)) {
      throw new Error(`Tracking ID ${trackingId} is already configured.`);
    }
    const scriptId = `script_${randomUUID().replaceAll("-", "")}`;
    metadata.scripts.push({
      id: scriptId,
      name: input.name,
      code: input.code,
      placement: input.placement,
      environment: input.environment,
      enabled: input.enabled ?? true,
      pages: {
        mode: input.pages?.mode ?? "all",
        paths: input.pages?.paths ?? [],
        patterns: input.pages?.patterns ?? []
      },
      owner: input.owner
    });
    await writeJson(filePath, metadata);
    const revision = await this.revisionService.commitRevision({
      site,
      source: "custom-script",
      title: `Added script ${input.name}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });
    return { revisionNumber: revision.revisionNumber, scriptId };
  }
}

function scriptHash(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

function detectTrackingId(code: string): string | undefined {
  return code.match(/\bG-[A-Z0-9]{6,}\b/)?.[0] ?? code.match(/\bGTM-[A-Z0-9]+\b/)?.[0];
}
