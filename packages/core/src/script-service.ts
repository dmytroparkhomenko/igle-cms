import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { assertCan, IgleError, scriptsMetadataSchema, type Actor } from "@igle/shared";
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

export interface ScriptRecord {
  id: string;
  name: string;
  code: string;
  placement: "head-start" | "head-end" | "body-start" | "body-end";
  environment: "preview" | "production" | "both";
  enabled: boolean;
  pages: { mode: "all" | "selected" | "patterns"; paths: string[]; patterns: string[] };
  owner?: string | undefined;
}

const gaPreset = (measurementId: string): string =>
  `<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${measurementId}');</script>`;

const gtmPreset = (containerId: string): string =>
  `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${containerId}');</script>`;

export const scriptPresets = { gaPreset, gtmPreset };

export class ScriptService {
  constructor(private readonly revisionService: RevisionService) {}

  async list(site: SiteRecord): Promise<ScriptRecord[]> {
    const filePath = path.join(site.repoPath, ".igle", "scripts.json");
    const metadata = scriptsMetadataSchema.parse(await readJson(filePath).catch(() => ({ scripts: [] })));
    return metadata.scripts;
  }

  async addScript(site: SiteRecord, input: ScriptInput, actor: Actor): Promise<{ revisionNumber: number; scriptId: string }> {
    assertCan(actor, "integrations.configure", site.id);
    const filePath = path.join(site.repoPath, ".igle", "scripts.json");
    const metadata = scriptsMetadataSchema.parse(await readJson(filePath).catch(() => ({ scripts: [] })));
    const hash = scriptHash(input.code);
    if (metadata.scripts.some((script) => scriptHash(script.code) === hash)) {
      throw new IgleError("DUPLICATE_SCRIPT", "A script with the same code is already configured.", 409);
    }
    const trackingId = detectTrackingId(input.code);
    if (trackingId && metadata.scripts.some((script) => detectTrackingId(script.code) === trackingId)) {
      throw new IgleError("DUPLICATE_TRACKING_ID", `Tracking ID ${trackingId} is already configured.`, 409);
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

  async setEnabled(site: SiteRecord, scriptId: string, enabled: boolean, actor: Actor): Promise<{ revisionNumber: number }> {
    assertCan(actor, "integrations.configure", site.id);
    const filePath = path.join(site.repoPath, ".igle", "scripts.json");
    const metadata = scriptsMetadataSchema.parse(await readJson(filePath).catch(() => ({ scripts: [] })));
    const script = metadata.scripts.find((item) => item.id === scriptId);
    if (!script) throw new IgleError("SCRIPT_NOT_FOUND", "Script was not found.", 404);
    script.enabled = enabled;
    await writeJson(filePath, metadata);
    const revision = await this.revisionService.commitRevision({
      site,
      source: "custom-script",
      title: `${enabled ? "Enabled" : "Disabled"} script ${script.name}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });
    return { revisionNumber: revision.revisionNumber };
  }

  async deleteScript(site: SiteRecord, scriptId: string, actor: Actor): Promise<{ revisionNumber: number }> {
    assertCan(actor, "integrations.configure", site.id);
    const filePath = path.join(site.repoPath, ".igle", "scripts.json");
    const metadata = scriptsMetadataSchema.parse(await readJson(filePath).catch(() => ({ scripts: [] })));
    const script = metadata.scripts.find((item) => item.id === scriptId);
    if (!script) throw new IgleError("SCRIPT_NOT_FOUND", "Script was not found.", 404);
    metadata.scripts = metadata.scripts.filter((item) => item.id !== scriptId);
    await writeJson(filePath, metadata);
    const revision = await this.revisionService.commitRevision({
      site,
      source: "custom-script",
      title: `Removed script ${script.name}`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });
    return { revisionNumber: revision.revisionNumber };
  }
}

function scriptHash(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

function detectTrackingId(code: string): string | undefined {
  return code.match(/\bG-[A-Z0-9]{6,}\b/)?.[0] ?? code.match(/\bGTM-[A-Z0-9]+\b/)?.[0];
}
