import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export interface AaPanelConfig {
  baseUrl: string;
  apiKey: string;
}

export class AaPanelError extends Error {
  public readonly raw: unknown;

  constructor(message: string, raw?: unknown) {
    super(message);
    this.name = "AaPanelError";
    this.raw = raw;
  }
}

interface AaPanelResponse {
  status?: boolean;
  msg?: string;
}

interface AaPanelSiteRow {
  id: number;
  name: string;
  path?: string;
  php_version?: string;
  ssl?: number;
  addtime?: string;
}

interface AaPanelSiteListResponse extends AaPanelResponse {
  // Confirmed live: /v2/data?action=getData wraps its payload in "message", unlike the flat
  // {status, msg} shape every /site?action=* and /files?action=* endpoint uses.
  message?: {
    data?: AaPanelSiteRow[];
  };
}

export interface AaPanelSiteSummary {
  id: number;
  domain: string;
  documentRoot: string;
  phpVersion?: string | undefined;
  sslEnabled: boolean;
  addedAt?: string | undefined;
}

export interface AaPanelDnsCheck {
  resolvedIps: string[];
  serverIps: string[];
  matches: boolean;
  error?: string | undefined;
}

interface AaPanelApplyCertResponse extends AaPanelResponse {
  private_key?: string;
  cert?: string;
  root?: string;
}

export interface AaPanelSite {
  id: number;
  documentRoot: string;
  created: boolean;
}

/**
 * Talks to a real aaPanel install over its signed HTTP API. Verified against aaPanel's own
 * demo.py/demo.php reference clients (auth scheme) and the community AzozzALFiras/aapanel-api
 * PHP client (endpoint shapes) — https://github.com/AzozzALFiras/aapanel-api — since aaPanel's
 * own docs site is JS-rendered and its PDF export isn't machine-readable. Isolated in one file
 * so it's easy to patch further after seeing a real response from a specific panel version.
 */
export class AaPanelProvider {
  constructor(private readonly config: AaPanelConfig) {}

  /** Read-only: confirms the base URL, API key, and IP allowlist actually work. */
  async testConnection(): Promise<{ ok: boolean; siteCount?: number; error?: string }> {
    try {
      const sites = await this.listSites();
      return { ok: true, siteCount: sites.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Connection test failed." };
    }
  }

  /** Read-only: every site already on the panel (up to 100), optionally filtered by name/remark. */
  async listSites(search = ""): Promise<AaPanelSiteSummary[]> {
    const query = new URLSearchParams({ action: "getData", table: "sites", search, limit: "100", p: "1", type: "-1", order: "" });
    const result = await this.call<AaPanelSiteListResponse>(`/v2/data?${query.toString()}`, {});
    const rows = result.message?.data ?? [];
    return rows.map((row) => ({
      id: row.id,
      domain: row.name,
      documentRoot: row.path && row.path.length > 0 ? row.path : defaultDocumentRoot(row.name),
      phpVersion: row.php_version,
      sslEnabled: typeof row.ssl === "number" && row.ssl >= 0,
      addedAt: row.addtime
    }));
  }

  /** Read-only: does a site for this domain already exist on the panel? */
  async findExistingSite(domain: string): Promise<AaPanelSiteSummary | undefined> {
    const sites = await this.listSites(domain);
    return sites.find((site) => site.domain === domain);
  }

  /**
   * Compares the domain's live A records against this aaPanel server's own IP(s) — the exact
   * mismatch that made two earlier test deploys here look like app failures when they were
   * really just DNS pointing somewhere else entirely.
   */
  async checkDomainDns(domain: string): Promise<AaPanelDnsCheck> {
    const serverIps = await this.resolveServerIps();
    try {
      const resolvedIps = await dns.resolve4(domain);
      return { resolvedIps, serverIps, matches: resolvedIps.some((ip) => serverIps.includes(ip)) };
    } catch (error) {
      return {
        resolvedIps: [],
        serverIps,
        matches: false,
        error: error instanceof Error ? error.message : "DNS lookup failed — no A record found."
      };
    }
  }

  private async resolveServerIps(): Promise<string[]> {
    let host: string;
    try {
      host = new URL(this.config.baseUrl).hostname;
    } catch {
      return [];
    }
    if (net.isIPv4(host)) return [host];
    return dns.resolve4(host).catch(() => []);
  }

  async ensureSite(domain: string): Promise<AaPanelSite> {
    const existing = await this.findExistingSite(domain);
    if (existing) return { id: existing.id, documentRoot: existing.documentRoot, created: false };

    await this.call("/site?action=AddSite", {
      webname: JSON.stringify({ domain, domainlist: [], count: 0 }),
      path: defaultDocumentRoot(domain),
      type_id: "0",
      type: "PHP",
      // "00" is aaPanel's static-site sentinel (site type name "Static"), confirmed live via
      // /site?action=GetPHPVersion — NOT "0", which this panel rejects as a nonexistent version.
      version: "00",
      port: "80",
      ps: `Igle CMS: ${domain}`,
      ftp: "false",
      sql: "0",
      codeing: "utf8"
    });

    // AddSite's own response shape isn't reliably documented — re-querying the list is the
    // one path that's confirmed to work for both branches.
    const created = await this.findExistingSite(domain);
    if (!created) throw new AaPanelError(`aaPanel reported success creating ${domain} but it doesn't show up in the site list.`);
    return { id: created.id, documentRoot: created.documentRoot, created: true };
  }

  async deployBuild(buildPath: string, documentRoot: string): Promise<void> {
    const zipPath = path.join(path.dirname(buildPath), `${path.basename(buildPath)}.zip`);
    await fs.rm(zipPath, { force: true });
    try {
      await execFile("zip", ["-rq", zipPath, "."], { cwd: buildPath });

      const zipBuffer = await fs.readFile(zipPath);
      const remoteZipName = "igle-deploy.zip";
      const form = new FormData();
      form.append("f_path", documentRoot);
      form.append("f_name", remoteZipName);
      form.append("f_size", String(zipBuffer.byteLength));
      form.append("f_start", "0");
      form.append("blob", new Blob([zipBuffer]), remoteZipName);

      const signed = this.sign();
      const uploadUrl = new URL(`${this.origin()}/files?action=upload`);
      uploadUrl.searchParams.set("request_time", signed.request_time);
      uploadUrl.searchParams.set("request_token", signed.request_token);

      const response = await fetch(uploadUrl, { method: "POST", body: form });
      if (!response.ok) {
        throw new AaPanelError(`aaPanel file upload failed with HTTP ${response.status}.`);
      }
      const json = (await response.json().catch(() => undefined)) as AaPanelResponse | undefined;
      if (json?.status === false) {
        throw new AaPanelError(json.msg ?? "aaPanel rejected the upload.", json);
      }

      const remoteZipPath = path.posix.join(documentRoot, remoteZipName);
      // "type" here is the archive format (zip), not encoding — the encoding param is "coding".
      await this.call("/files?action=UnZip", { sfile: remoteZipPath, dfile: documentRoot, type: "zip", coding: "UTF-8" });
      await this.call("/files?action=DeleteFile", { path: remoteZipPath }).catch(() => undefined);
    } finally {
      await fs.rm(zipPath, { force: true });
    }
  }

  /**
   * Best-effort, two-step: issuing a Let's Encrypt cert (apply_cert_api) does not attach it to
   * the site by itself — it has to be handed to SetSSL afterward. Non-blocking: SSL issues
   * shouldn't prevent the build from going live over plain HTTP.
   */
  async applySSL(domain: string, siteId: number): Promise<{ ok: boolean; error?: string }> {
    try {
      const issued = await this.call<AaPanelApplyCertResponse>("/acme?action=apply_cert_api", {
        domains: JSON.stringify([domain]),
        id: String(siteId),
        auth_to: String(siteId),
        auth_type: "http",
        auto_wildcard: "0"
      });
      if (!issued.private_key || !issued.cert) {
        throw new AaPanelError("aaPanel didn't return a certificate from apply_cert_api.", issued);
      }
      const certificate = issued.root ? `${issued.cert} ${issued.root}` : issued.cert;
      await this.call("/site?action=SetSSL", {
        type: "2",
        siteName: domain,
        key: issued.private_key,
        csr: certificate
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "SSL request failed." };
    }
  }

  async smokeTest(domain: string, https: boolean): Promise<{ ok: boolean; failures: string[] }> {
    const protocol = https ? "https" : "http";
    try {
      const response = await fetch(`${protocol}://${domain}/`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return { ok: false, failures: [`${protocol}://${domain}/ returned HTTP ${response.status}`] };
      return { ok: true, failures: [] };
    } catch (error) {
      return { ok: false, failures: [error instanceof Error ? error.message : "Smoke test request failed."] };
    }
  }

  private origin(): string {
    return this.config.baseUrl.replace(/\/$/, "");
  }

  private sign(): { request_time: string; request_token: string } {
    // Confirmed against aaPanel's own demo.py/demo.php: time.time()/time() — whole seconds,
    // not milliseconds (aaPanel's own Postman collection example uses Date.now(), which
    // disagrees with its own reference client code; the two shipped demos win).
    const requestTime = Math.floor(Date.now() / 1000).toString();
    const keyHash = createHash("md5").update(this.config.apiKey).digest("hex");
    const token = createHash("md5").update(`${requestTime}${keyHash}`).digest("hex");
    return { request_time: requestTime, request_token: token };
  }

  private async call<T extends AaPanelResponse>(pathAndAction: string, params: Record<string, string>): Promise<T> {
    const body = new URLSearchParams({ ...this.sign(), ...params });
    const response = await fetch(`${this.origin()}${pathAndAction}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) {
      throw new AaPanelError(`aaPanel request to ${pathAndAction} failed with HTTP ${response.status}.`);
    }
    const text = await response.text();
    let json: T;
    try {
      json = JSON.parse(text) as T;
    } catch {
      throw new AaPanelError(`aaPanel returned a non-JSON response from ${pathAndAction}: ${text.slice(0, 200)}`);
    }
    if (json.status === false) {
      throw new AaPanelError(json.msg ?? `aaPanel reported failure from ${pathAndAction}.`, json);
    }
    return json;
  }
}

function defaultDocumentRoot(domain: string): string {
  return `/www/wwwroot/${domain}`;
}
