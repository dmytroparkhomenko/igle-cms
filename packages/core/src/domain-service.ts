import { AaPanelProvider, CloudflareProvider } from "@igle/deployer";
import { assertCan, IgleError, type Actor } from "@igle/shared";
import { CloudflareAccountService } from "./cloudflare-account-service.js";
import { ServerService } from "./server-service.js";
import { SiteService } from "./site-service.js";
import { JsonStateStore, id } from "./state-store.js";
import type { DomainRecord } from "./types.js";

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Connects a domain to the tool independently of any site — so a freshly-bought domain can be
 * pointed at Cloudflare and a server before there's necessarily a site ready to go on it yet.
 * Two deliberately separate steps, since they depend on different things finishing first:
 *   1. connect() — creates the Cloudflare zone, a proxied DNS record, and permissive SSL. Works
 *      immediately, before the domain's nameservers have even been switched at the registrar.
 *   2. issueOriginSsl() — only meaningful once the zone is active (Cloudflare doesn't proxy
 *      traffic, including the Let's Encrypt challenge, through a pending zone). Issues a real
 *      cert on the origin via aaPanel, then locks Cloudflare's SSL mode down to "strict".
 */
export class DomainService {
  constructor(
    private readonly stateStore: JsonStateStore,
    private readonly cloudflareAccountService: CloudflareAccountService,
    private readonly serverService: ServerService,
    private readonly siteService: SiteService
  ) {}

  async list(actor: Actor): Promise<DomainRecord[]> {
    assertCan(actor, "domains.manage");
    const state = await this.stateStore.read();
    return state.domains.slice().sort((a, b) => a.domain.localeCompare(b.domain));
  }

  async connect(input: { domain: string; cloudflareAccountId: string; serverId: string }, actor: Actor): Promise<DomainRecord> {
    assertCan(actor, "domains.manage");
    const domainName = normalizeDomain(input.domain);
    if (!domainName) throw new IgleError("VALIDATION_ERROR", "Enter a valid domain, e.g. example.com.", 400);

    const state = await this.stateStore.read();
    if (state.domains.some((item) => item.domain === domainName)) {
      throw new IgleError("DOMAIN_EXISTS", "This domain is already connected.", 409);
    }

    const account = await this.cloudflareAccountService.getInternal(input.cloudflareAccountId);
    if (!account) throw new IgleError("CLOUDFLARE_ACCOUNT_NOT_FOUND", "Cloudflare account was not found.", 404);
    const server = await this.serverService.getInternal(input.serverId);
    if (!server) throw new IgleError("SERVER_NOT_FOUND", "Server was not found.", 404);
    if (server.restricted && !actor.canDeployRestricted) {
      throw new IgleError("FORBIDDEN_RESTRICTED_SERVER", `"${server.name}" is a restricted server — only administrators granted access can use it.`, 403);
    }
    if (!server.publicIp) {
      throw new IgleError("SERVER_PUBLIC_IP_REQUIRED", `Set a public IP for "${server.name}" in Servers before connecting a domain to it.`, 400);
    }

    const now = new Date().toISOString();
    const record: DomainRecord = {
      id: id("domain"),
      domain: domainName,
      cloudflareAccountId: input.cloudflareAccountId,
      serverId: input.serverId,
      zoneActive: false,
      status: "pending_nameservers",
      createdAt: now,
      updatedAt: now
    };

    const provider = new CloudflareProvider({ apiToken: account.apiToken, accountId: account.accountId });
    try {
      const zone = await provider.ensureZone(domainName);
      record.zoneId = zone.id;
      record.nameservers = zone.nameServers;
      record.zoneActive = zone.status === "active";

      const dnsRecord = await provider.upsertARecord(zone.id, domainName, server.publicIp);
      record.dnsRecordId = dnsRecord.id;
      await provider.setSslMode(zone.id, "full");
      record.sslMode = "full";
      record.status = record.zoneActive ? "dns_configured" : "pending_nameservers";
    } catch (error) {
      record.status = "error";
      record.lastError = error instanceof Error ? error.message : "Failed to connect domain to Cloudflare.";
    }

    await this.stateStore.update((next) => {
      next.domains.push(record);
    });
    return record;
  }

  /** Re-checks the zone's activation status — nameserver propagation can take minutes to ~48h, so this is meant to be called again later, not assumed to resolve instantly. */
  async refreshStatus(domainId: string, actor: Actor): Promise<DomainRecord> {
    assertCan(actor, "domains.manage");
    const domain = await this.requireDomain(domainId);
    if (!domain.zoneId) return domain;
    const account = await this.cloudflareAccountService.getInternal(domain.cloudflareAccountId);
    if (!account) throw new IgleError("CLOUDFLARE_ACCOUNT_NOT_FOUND", "Cloudflare account was not found.", 404);

    const provider = new CloudflareProvider({ apiToken: account.apiToken, accountId: account.accountId });
    const zone = await provider.getZoneStatus(domain.zoneId);
    return this.updateDomain(domainId, (record) => {
      record.nameservers = zone.nameServers;
      record.zoneActive = zone.status === "active";
      if (record.status !== "ssl_active") {
        record.status = zone.status === "active" ? "dns_configured" : "pending_nameservers";
      }
    });
  }

  async issueOriginSsl(domainId: string, actor: Actor): Promise<DomainRecord> {
    assertCan(actor, "domains.manage");
    const domain = await this.requireDomain(domainId);
    if (!domain.zoneActive) {
      throw new IgleError(
        "ZONE_NOT_ACTIVE",
        "Wait for the Cloudflare zone to become active (nameservers propagated) before issuing a certificate.",
        400
      );
    }
    const server = await this.serverService.getInternal(domain.serverId);
    if (!server) throw new IgleError("SERVER_NOT_FOUND", "Server was not found.", 404);
    if (server.restricted && !actor.canDeployRestricted) {
      throw new IgleError("FORBIDDEN_RESTRICTED_SERVER", `"${server.name}" is a restricted server — only administrators granted access can use it.`, 403);
    }

    const aapanel = new AaPanelProvider(server);
    const site = await aapanel.ensureSite(domain.domain);
    const ssl = await aapanel.applySSL(domain.domain, site.id);
    if (!ssl.ok) {
      return this.updateDomain(domainId, (record) => {
        record.status = "error";
        record.lastError = ssl.error ?? "Failed to issue a certificate on the origin.";
      });
    }

    const account = await this.cloudflareAccountService.getInternal(domain.cloudflareAccountId);
    if (account && domain.zoneId) {
      const provider = new CloudflareProvider({ apiToken: account.apiToken, accountId: account.accountId });
      await provider.setSslMode(domain.zoneId, "strict");
    }

    return this.updateDomain(domainId, (record) => {
      record.sslMode = "strict";
      record.status = "ssl_active";
      record.lastError = undefined;
    });
  }

  /** Links the domain to a site record-side (for display) AND wires it into that site's own deploy settings, so the existing Deploy flow picks it up without a separate manual step. */
  async assignToSite(domainId: string, siteId: string, actor: Actor): Promise<DomainRecord> {
    assertCan(actor, "domains.manage");
    const domain = await this.requireDomain(domainId);
    const site = await this.siteService.get(siteId, actor);
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    await this.siteService.updateSettings(
      site,
      { domain: domain.domain, deploymentTarget: "aapanel", serverId: domain.serverId },
      actor
    );

    return this.updateDomain(domainId, (record) => {
      record.siteId = siteId;
    });
  }

  async unassign(domainId: string, actor: Actor): Promise<DomainRecord> {
    assertCan(actor, "domains.manage");
    return this.updateDomain(domainId, (record) => {
      record.siteId = undefined;
    });
  }

  async remove(domainId: string, actor: Actor): Promise<void> {
    assertCan(actor, "domains.manage");
    await this.stateStore.update((state) => {
      state.domains = state.domains.filter((item) => item.id !== domainId);
    });
  }

  private async requireDomain(domainId: string): Promise<DomainRecord> {
    const state = await this.stateStore.read();
    const domain = state.domains.find((item) => item.id === domainId);
    if (!domain) throw new IgleError("DOMAIN_NOT_FOUND", "Domain was not found.", 404);
    return domain;
  }

  private async updateDomain(domainId: string, mutate: (record: DomainRecord) => void): Promise<DomainRecord> {
    return this.stateStore.update((state) => {
      const record = state.domains.find((item) => item.id === domainId);
      if (!record) throw new IgleError("DOMAIN_NOT_FOUND", "Domain was not found.", 404);
      mutate(record);
      record.updatedAt = new Date().toISOString();
      return record;
    });
  }
}

function normalizeDomain(value: string): string | undefined {
  const trimmed = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return DOMAIN_PATTERN.test(trimmed) ? trimmed : undefined;
}
