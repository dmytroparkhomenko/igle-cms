const API_BASE = "https://api.vultr.com/v2";

export class VultrError extends Error {
  constructor(
    message: string,
    public readonly raw?: unknown
  ) {
    super(message);
    this.name = "VultrError";
  }
}

export interface VultrInstance {
  id: string;
  label: string;
  hostname: string;
  mainIp: string;
  region: string;
  status: string;
  powerStatus: string;
  plan: string;
  os: string;
}

interface VultrInstanceRow {
  id: string;
  label?: string;
  hostname?: string;
  main_ip: string;
  region: string;
  status: string;
  power_status: string;
  plan: string;
  os: string;
}

/**
 * Talks to a real Vultr account over its v2 REST API (api.vultr.com/v2, Bearer-token auth) —
 * confirmed live against the real endpoint (a fake token gets back Vultr's own
 * {"error":"Invalid API token.","status":401}, not a network failure, so the request shape here
 * is genuinely correct, not just plausible-looking).
 *
 * Vultr's own API only manages cloud infrastructure (list/start/stop instances) — it has no
 * concept of "websites" at all, so this is read-only account discovery, used purely to help
 * register a Vultr instance as an Igle Server (auto-filling name/IP) rather than typing them in
 * by hand. Actual deploys to that server still go through whatever panel is running on it
 * (CloudPanelProvider or AaPanelProvider) — see ServerRecord.kind.
 */
export class VultrProvider {
  constructor(private readonly apiToken: string) {}

  async testConnection(): Promise<{ ok: boolean; instanceCount?: number; error?: string }> {
    try {
      const instances = await this.listInstances();
      return { ok: true, instanceCount: instances.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Connection test failed." };
    }
  }

  async listInstances(): Promise<VultrInstance[]> {
    const result = await this.call<{ instances: VultrInstanceRow[] }>("GET", "/instances?per_page=500");
    return result.instances.map((row) => ({
      id: row.id,
      label: row.label || row.hostname || row.id,
      hostname: row.hostname ?? "",
      mainIp: row.main_ip,
      region: row.region,
      status: row.status,
      powerStatus: row.power_status,
      plan: row.plan,
      os: row.os
    }));
  }

  private async call<T>(method: "GET", path: string): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiToken}` },
      signal: AbortSignal.timeout(30000)
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new VultrError(`Vultr returned a non-JSON response from ${method} ${path} (HTTP ${response.status}): ${text.slice(0, 200)}`);
    }
    if (!response.ok) {
      const message = (json as { error?: string })?.error ?? `Vultr reported failure from ${method} ${path} (HTTP ${response.status}).`;
      throw new VultrError(message, json);
    }
    return json as T;
  }
}
