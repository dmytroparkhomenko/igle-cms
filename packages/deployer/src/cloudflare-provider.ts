const API_BASE = "https://api.cloudflare.com/client/v4";

export interface CloudflareConfig {
  apiToken: string;
  accountId?: string | undefined;
}

export class CloudflareError extends Error {
  public readonly raw: unknown;

  constructor(message: string, raw?: unknown) {
    super(message);
    this.name = "CloudflareError";
    this.raw = raw;
  }
}

interface CloudflareEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T;
}

export interface CloudflareZone {
  id: string;
  status: string;
  nameServers: string[];
}

export interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

/**
 * Talks to a real Cloudflare account over its standard v4 REST API (api.cloudflare.com/client/v4,
 * Bearer-token auth). Every response is the same {success, errors, result} envelope regardless of
 * endpoint, so one call() wrapper covers all of it — mirrors AaPanelProvider's shape for the same
 * reason: easy to extend once real traffic surfaces an endpoint quirk this can't predict from docs
 * alone. Unlike AaPanelProvider, this hasn't been exercised against a live account yet — verify the
 * first real connect/DNS/SSL call against your own Cloudflare account before relying on it.
 */
export class CloudflareProvider {
  constructor(private readonly config: CloudflareConfig) {}

  /** Read-only: confirms the token actually authenticates and can see zones. */
  async testConnection(): Promise<{ ok: boolean; zoneCount?: number; error?: string }> {
    try {
      const zones = await this.call<Array<{ id: string }>>("GET", "/zones?per_page=1");
      return { ok: true, zoneCount: zones.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Connection test failed." };
    }
  }

  /** Looks up a zone already on this account by exact domain name. */
  async findZone(domain: string): Promise<CloudflareZone | undefined> {
    const zones = await this.call<
      Array<{ id: string; status: string; name_servers?: string[] }>
    >("GET", `/zones?name=${encodeURIComponent(domain)}`);
    const zone = zones[0];
    if (!zone) return undefined;
    return { id: zone.id, status: zone.status, nameServers: zone.name_servers ?? [] };
  }

  /** Creates the zone if it doesn't already exist on this account — the first real step in connecting a domain. */
  async ensureZone(domain: string): Promise<CloudflareZone> {
    const existing = await this.findZone(domain);
    if (existing) return existing;

    const body: Record<string, unknown> = { name: domain };
    if (this.config.accountId) body.account = { id: this.config.accountId };
    const zone = await this.call<{ id: string; status: string; name_servers?: string[] }>("POST", "/zones", body);
    return { id: zone.id, status: zone.status, nameServers: zone.name_servers ?? [] };
  }

  /** Re-checks a zone's activation status (and nameservers, in case Cloudflare re-issued them) without trying to create anything. */
  async getZoneStatus(zoneId: string): Promise<CloudflareZone> {
    const zone = await this.call<{ id: string; status: string; name_servers?: string[] }>("GET", `/zones/${zoneId}`);
    return { id: zone.id, status: zone.status, nameServers: zone.name_servers ?? [] };
  }

  /**
   * Creates (or updates in place) a proxied A record for the domain pointing at the origin IP.
   * Cloudflare accepts DNS writes on a pending zone — the record just won't resolve publicly
   * until the zone activates — so this doesn't need to wait for zoneActive first.
   */
  async upsertARecord(zoneId: string, domain: string, ip: string): Promise<CloudflareDnsRecord> {
    const existing = await this.call<Array<{ id: string; type: string; name: string; content: string; proxied: boolean }>>(
      "GET",
      `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(domain)}`
    );
    const body = { type: "A", name: domain, content: ip, ttl: 1, proxied: true };
    const record = existing[0]
      ? await this.call<{ id: string; type: string; name: string; content: string; proxied: boolean }>(
          "PUT",
          `/zones/${zoneId}/dns_records/${existing[0].id}`,
          body
        )
      : await this.call<{ id: string; type: string; name: string; content: string; proxied: boolean }>(
          "POST",
          `/zones/${zoneId}/dns_records`,
          body
        );
    return { id: record.id, type: record.type, name: record.name, content: record.content, proxied: record.proxied };
  }

  /**
   * "full" trusts any cert on the origin (even self-signed) — the safe default right after
   * connecting a domain, before the origin has a real certificate yet. "strict" additionally
   * requires that cert to be from a trusted CA — only switch to it once aaPanel has actually
   * issued a Let's Encrypt cert on the origin, or visitors get a 526 error.
   */
  async setSslMode(zoneId: string, mode: "full" | "strict"): Promise<void> {
    await this.call("PATCH", `/zones/${zoneId}/settings/ssl`, { value: mode === "strict" ? "strict" : "full" });
  }

  private async call<T>(method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : null,
      signal: AbortSignal.timeout(30000)
    });
    const text = await response.text();
    let json: CloudflareEnvelope<T>;
    try {
      json = JSON.parse(text) as CloudflareEnvelope<T>;
    } catch {
      throw new CloudflareError(`Cloudflare returned a non-JSON response from ${method} ${path} (HTTP ${response.status}): ${text.slice(0, 200)}`);
    }
    if (!json.success) {
      const message = json.errors?.map((error) => error.message).join("; ") || `Cloudflare reported failure from ${method} ${path}.`;
      throw new CloudflareError(message, json);
    }
    return json.result;
  }
}
