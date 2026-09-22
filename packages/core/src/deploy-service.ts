import dns from "node:dns/promises";
import path from "node:path";
import { buildSite, type BuildIssue } from "@igle/build";
import {
  AaPanelProvider,
  CloudPanelProvider,
  LocalReleaseDeploymentProvider,
  type AaPanelConfig,
  type AaPanelDnsCheck,
  type AaPanelSiteSummary,
  type CloudPanelConfig
} from "@igle/deployer";
import { assertCan, effectiveSiteLanguageTag, IgleError, type Actor } from "@igle/shared";
import { RevisionService } from "./revision-service.js";
import { ServerService } from "./server-service.js";
import { JsonStateStore, id } from "./state-store.js";
import type { DeploymentRecord, ServerRecord, SiteRecord, SiteRevisionRecord } from "./types.js";

const localProvider = new LocalReleaseDeploymentProvider();

/** ServerService.add only ever persists an aaPanel server with these fields set — this just narrows the type at the point of use. */
function aaPanelConfig(server: ServerRecord): AaPanelConfig {
  if (!server.baseUrl || !server.apiKey) {
    throw new IgleError("SERVER_MISCONFIGURED", `"${server.name}" is missing its aaPanel base URL or API key.`, 500);
  }
  return { baseUrl: server.baseUrl, apiKey: server.apiKey };
}

/** ServerService.add only ever persists a CloudPanel server with sshHost set and either a password or private key — this just narrows the type at the point of use. */
function cloudPanelConfig(server: ServerRecord): CloudPanelConfig {
  if (!server.sshHost) {
    throw new IgleError("SERVER_MISCONFIGURED", `"${server.name}" is missing its SSH host.`, 500);
  }
  return {
    host: server.sshHost,
    port: server.sshPort,
    username: server.sshUsername,
    password: server.sshPassword,
    privateKey: server.sshPrivateKey
  };
}

export class DeployService {
  constructor(
    private readonly dataDir: string,
    private readonly stateStore: JsonStateStore,
    private readonly revisionService: RevisionService,
    private readonly serverService: ServerService
  ) {}

  /** Resolves and permission-checks the server a site is assigned to. Throws a clear, specific error at every failure point. */
  private async resolveServerForDeploy(site: SiteRecord, actor: Actor): Promise<ServerRecord> {
    const serverId = site.metadata.serverId;
    if (!serverId) {
      throw new IgleError("SERVER_REQUIRED", "Pick a server for this site in Site Settings before deploying.", 400);
    }
    const server = await this.serverService.getInternal(serverId);
    if (!server) {
      throw new IgleError("SERVER_NOT_FOUND", "This site's assigned server no longer exists — pick another one in Site Settings.", 400);
    }
    // The restricted-access gate is an affiliate-only concept — PBN sites can use any server.
    if (server.restricted && actor.role !== "administrator" && site.metadata.category !== "pbn") {
      throw new IgleError("FORBIDDEN_RESTRICTED_SERVER", `"${server.name}" is a restricted server — only administrators can deploy to it.`, 403);
    }
    return server;
  }

  /** Works for either panel kind — CloudPanel has no equivalent to aaPanel's site-list API, so this is the only cross-kind connection check. */
  async testServerConnection(serverId: string, actor: Actor): Promise<{ ok: boolean; siteCount?: number; error?: string }> {
    const server = await this.serverService.getInternal(serverId);
    if (!server) return { ok: false, error: "Server was not found." };
    if (server.restricted && actor.role !== "administrator") return { ok: false, error: "You don't have access to this restricted server." };
    if (server.kind === "cloudpanel") return new CloudPanelProvider(cloudPanelConfig(server)).testConnection();
    return new AaPanelProvider(aaPanelConfig(server)).testConnection();
  }

  /** @deprecated use testServerConnection — kept as an alias so existing callers keep working. */
  async testAaPanelConnection(serverId: string, actor: Actor): Promise<{ ok: boolean; siteCount?: number; error?: string }> {
    return this.testServerConnection(serverId, actor);
  }

  /** aaPanel-only — CloudPanel has no documented way to list its existing sites (see CloudPanelProvider). Returns empty for a CloudPanel server rather than failing the caller. */
  async listAaPanelSites(serverId: string, actor: Actor, search?: string, forPbn = false): Promise<AaPanelSiteSummary[]> {
    const server = await this.requireSelectableServer(serverId, actor, forPbn);
    if (server.kind !== "aapanel") return [];
    return new AaPanelProvider(aaPanelConfig(server)).listSites(search);
  }

  async findExistingAaPanelSite(serverId: string, actor: Actor, domain: string, forPbn = false): Promise<AaPanelSiteSummary | undefined> {
    const server = await this.serverService.getInternal(serverId);
    if (!server || (server.restricted && actor.role !== "administrator" && !forPbn) || server.kind !== "aapanel") return undefined;
    return new AaPanelProvider(aaPanelConfig(server)).findExistingSite(domain);
  }

  async checkAaPanelDns(serverId: string, actor: Actor, domain: string, forPbn = false): Promise<AaPanelDnsCheck> {
    const server = await this.requireSelectableServer(serverId, actor, forPbn);
    if (server.kind === "aapanel") return new AaPanelProvider(aaPanelConfig(server)).checkDomainDns(domain);

    // CloudPanel has no API to ask directly, but the same "does this domain's DNS point here"
    // check is just generic DNS resolution against the server's own known public IP.
    const serverIps = server.publicIp ? [server.publicIp] : [];
    try {
      const resolvedIps = await dns.resolve4(domain);
      return { resolvedIps, serverIps, matches: resolvedIps.some((ip) => serverIps.includes(ip)) };
    } catch (error) {
      return { resolvedIps: [], serverIps, matches: false, error: error instanceof Error ? error.message : "DNS lookup failed — no A record found." };
    }
  }

  // The restricted-access gate is an affiliate-only concept — pass forPbn for a PBN site's server to skip it.
  private async requireSelectableServer(serverId: string, actor: Actor, forPbn = false): Promise<ServerRecord> {
    const server = await this.serverService.getInternal(serverId);
    if (!server) throw new IgleError("SERVER_NOT_FOUND", "Server was not found.", 404);
    if (server.restricted && actor.role !== "administrator" && !forPbn) {
      throw new IgleError("FORBIDDEN_RESTRICTED_SERVER", `"${server.name}" is a restricted server — only administrators can use it.`, 403);
    }
    return server;
  }

  /**
   * Deploys `site`, then — if it's half of a mirror pair (see MirrorService) — deploys the
   * paired site too, so the two stay published together the way "full copy" mirroring implies.
   * The partner's own deploy settings (server, restricted-server access, domain) are still
   * enforced independently; a partner failure is reported alongside the primary result rather
   * than failing it, so an unrelated problem on one side can't block deploying the other.
   */
  async deploy(site: SiteRecord, actor: Actor): Promise<{ deployment: DeploymentRecord; mirror?: { site: SiteRecord; deployment?: DeploymentRecord; error?: string } }> {
    assertCan(actor, "sites.deploy", site.id);
    const deployment = await this.deployOne(site, actor);

    const partner = await this.findMirrorPartner(site);
    if (!partner) return { deployment };

    try {
      assertCan(actor, "sites.deploy", partner.id);
      const mirrorDeployment = await this.deployOne(partner, actor);
      return { deployment, mirror: { site: partner, deployment: mirrorDeployment } };
    } catch (error) {
      return { deployment, mirror: { site: partner, error: error instanceof Error ? error.message : "Mirror deploy failed." } };
    }
  }

  private async findMirrorPartner(site: SiteRecord): Promise<SiteRecord | undefined> {
    const state = await this.stateStore.read();
    if (site.metadata.mirrorOfSiteId) {
      return state.sites.find((item) => item.id === site.metadata.mirrorOfSiteId);
    }
    return state.sites.find((item) => item.metadata.mirrorOfSiteId === site.id);
  }

  private async deployOne(site: SiteRecord, actor: Actor): Promise<DeploymentRecord> {
    const revision = await this.revisionService.latest(site.id);
    if (!revision) throw new IgleError("NO_REVISION", "This site has no revisions to deploy yet.", 400);

    const partner = await this.findMirrorPartner(site);
    const hreflangPartner =
      partner && partner.metadata.domain
        ? { baseUrl: productionBaseUrl(partner)!, languageTag: effectiveSiteLanguageTag(partner.metadata) }
        : undefined;

    if (site.metadata.deploymentTarget === "aapanel") {
      const server = await this.resolveServerForDeploy(site, actor);
      if (server.kind === "cloudpanel") return this.deployToCloudPanel(site, revision, server, actor, hreflangPartner);
      return this.deployToAaPanel(site, revision, server, actor, hreflangPartner);
    }
    return this.deployLocally(site, revision, actor, hreflangPartner);
  }

  private async deployLocally(
    site: SiteRecord,
    revision: SiteRevisionRecord,
    actor: Actor,
    hreflangPartner?: { baseUrl: string; languageTag: string }
  ): Promise<DeploymentRecord> {
    const buildsRoot = path.join(this.dataDir, "builds");
    const baseUrl = productionBaseUrl(site);
    const result = await buildSite({
      siteId: site.id,
      repoPath: site.repoPath,
      commitSha: revision.commitSha,
      buildsRoot,
      ...(baseUrl ? { productionBaseUrl: baseUrl } : {}),
      ...(hreflangPartner ? { hreflangPartner } : {})
    });

    const buildIssues = summarizeIssues(result.issues);
    const blockingErrors = result.issues.filter((issue) => issue.class === "error");
    if (blockingErrors.length > 0) {
      return this.recordDeployment({
        siteId: site.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        kind: "deploy",
        status: "failed",
        target: "local",
        buildIssues,
        error: `Build has ${blockingErrors.length} blocking issue(s): ${blockingErrors.map((issue) => issue.message).join("; ")}`,
        createdByUserId: actor.id
      });
    }

    const remoteDirectory = path.join(this.dataDir, "releases", site.slug);
    try {
      const deployed = await localProvider.deploy({
        buildPath: result.buildPath,
        remoteDirectory,
        revisionId: revision.id,
        smoke: { autoRollback: true }
      });

      const record = await this.recordDeployment({
        siteId: site.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        kind: "deploy",
        status: "success",
        target: "local",
        releasePath: deployed.releasePath,
        buildIssues,
        createdByUserId: actor.id
      });

      await this.setProductionRevision(site.id, revision.id);
      return record;
    } catch (error) {
      return this.recordDeployment({
        siteId: site.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        kind: "deploy",
        status: "failed",
        target: "local",
        buildIssues,
        error: error instanceof Error ? error.message : "Deployment failed.",
        createdByUserId: actor.id
      });
    }
  }

  private async deployToAaPanel(
    site: SiteRecord,
    revision: SiteRevisionRecord,
    server: ServerRecord,
    actor: Actor,
    hreflangPartner?: { baseUrl: string; languageTag: string }
  ): Promise<DeploymentRecord> {
    if (!site.metadata.domain) {
      throw new IgleError("DOMAIN_REQUIRED", "Set a domain in this site's settings before deploying to a VPS.", 400);
    }

    const domain = site.metadata.domain;
    const buildsRoot = path.join(this.dataDir, "builds");
    const baseUrl = productionBaseUrl(site);
    const result = await buildSite({
      siteId: site.id,
      repoPath: site.repoPath,
      commitSha: revision.commitSha,
      buildsRoot,
      ...(baseUrl ? { productionBaseUrl: baseUrl } : {}),
      ...(hreflangPartner ? { hreflangPartner } : {})
    });

    const buildIssues = summarizeIssues(result.issues);
    const blockingErrors = result.issues.filter((issue) => issue.class === "error");
    if (blockingErrors.length > 0) {
      return this.recordDeployment({
        siteId: site.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        kind: "deploy",
        status: "failed",
        target: "aapanel",
        buildIssues,
        error: `Build has ${blockingErrors.length} blocking issue(s): ${blockingErrors.map((issue) => issue.message).join("; ")}`,
        createdByUserId: actor.id
      });
    }

    const provider = new AaPanelProvider(aaPanelConfig(server));
    try {
      const { id: aapanelSiteId, documentRoot } = await provider.ensureSite(domain);
      await provider.deployBuild(result.buildPath, documentRoot);

      let sslError: string | undefined;
      if (site.metadata.https) {
        const ssl = await provider.applySSL(domain, aapanelSiteId);
        if (!ssl.ok) sslError = ssl.error;
      }

      const smoke = await provider.smokeTest(domain, site.metadata.https && !sslError);
      if (!smoke.ok) {
        return this.recordDeployment({
          siteId: site.id,
          revisionId: revision.id,
          revisionNumber: revision.revisionNumber,
          kind: "deploy",
          status: "failed",
          target: "aapanel",
          releasePath: `aapanel:${documentRoot}`,
          buildIssues,
          error: `Files were uploaded but the live smoke test failed: ${smoke.failures.join("; ")}`,
          ...(sslError ? { sslError } : {}),
          createdByUserId: actor.id
        });
      }

      const record = await this.recordDeployment({
        siteId: site.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        kind: "deploy",
        status: "success",
        target: "aapanel",
        releasePath: `aapanel:${documentRoot}`,
        buildIssues,
        ...(sslError ? { sslError } : {}),
        createdByUserId: actor.id
      });

      await this.setProductionRevision(site.id, revision.id);
      return record;
    } catch (error) {
      return this.recordDeployment({
        siteId: site.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        kind: "deploy",
        status: "failed",
        target: "aapanel",
        buildIssues,
        error: error instanceof Error ? error.message : "Deployment to aaPanel failed.",
        createdByUserId: actor.id
      });
    }
  }

  /** Same shape as deployToAaPanel, but over SSH/clpctl instead of aaPanel's REST API — see CloudPanelProvider. */
  private async deployToCloudPanel(
    site: SiteRecord,
    revision: SiteRevisionRecord,
    server: ServerRecord,
    actor: Actor,
    hreflangPartner?: { baseUrl: string; languageTag: string }
  ): Promise<DeploymentRecord> {
    if (!site.metadata.domain) {
      throw new IgleError("DOMAIN_REQUIRED", "Set a domain in this site's settings before deploying to a VPS.", 400);
    }

    const domain = site.metadata.domain;
    const buildsRoot = path.join(this.dataDir, "builds");
    const baseUrl = productionBaseUrl(site);
    const result = await buildSite({
      siteId: site.id,
      repoPath: site.repoPath,
      commitSha: revision.commitSha,
      buildsRoot,
      ...(baseUrl ? { productionBaseUrl: baseUrl } : {}),
      ...(hreflangPartner ? { hreflangPartner } : {})
    });

    const buildIssues = summarizeIssues(result.issues);
    const blockingErrors = result.issues.filter((issue) => issue.class === "error");
    if (blockingErrors.length > 0) {
      return this.recordDeployment({
        siteId: site.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        kind: "deploy",
        status: "failed",
        target: "aapanel",
        buildIssues,
        error: `Build has ${blockingErrors.length} blocking issue(s): ${blockingErrors.map((issue) => issue.message).join("; ")}`,
        createdByUserId: actor.id
      });
    }

    const provider = new CloudPanelProvider(cloudPanelConfig(server));
    try {
      const cpSite = await provider.ensureSite(domain);
      await provider.deployBuild(result.buildPath, cpSite);

      let sslError: string | undefined;
      if (site.metadata.https) {
        const ssl = await provider.applySSL(domain);
        if (!ssl.ok) sslError = ssl.error;
      }

      const smoke = await provider.smokeTest(domain, site.metadata.https && !sslError);
      if (!smoke.ok) {
        return this.recordDeployment({
          siteId: site.id,
          revisionId: revision.id,
          revisionNumber: revision.revisionNumber,
          kind: "deploy",
          status: "failed",
          target: "aapanel",
          releasePath: `cloudpanel:${cpSite.documentRoot}`,
          buildIssues,
          error: `Files were uploaded but the live smoke test failed: ${smoke.failures.join("; ")}`,
          ...(sslError ? { sslError } : {}),
          createdByUserId: actor.id
        });
      }

      const record = await this.recordDeployment({
        siteId: site.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        kind: "deploy",
        status: "success",
        target: "aapanel",
        releasePath: `cloudpanel:${cpSite.documentRoot}`,
        buildIssues,
        ...(sslError ? { sslError } : {}),
        createdByUserId: actor.id
      });

      await this.setProductionRevision(site.id, revision.id);
      return record;
    } catch (error) {
      return this.recordDeployment({
        siteId: site.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        kind: "deploy",
        status: "failed",
        target: "aapanel",
        buildIssues,
        error: error instanceof Error ? error.message : "Deployment to CloudPanel failed.",
        createdByUserId: actor.id
      });
    }
  }

  async rollback(site: SiteRecord, deploymentId: string, actor: Actor): Promise<DeploymentRecord> {
    assertCan(actor, "sites.deploy", site.id);
    const state = await this.stateStore.read();
    const target = state.deployments.find((item) => item.id === deploymentId && item.siteId === site.id);
    if (!target || target.status !== "success" || !target.releasePath) {
      throw new IgleError("DEPLOYMENT_NOT_FOUND", "That deployment can't be rolled back to.", 404);
    }
    if (target.target === "aapanel") {
      throw new IgleError("ROLLBACK_UNSUPPORTED", "Rolling back an aaPanel deployment isn't supported yet — redeploy an earlier revision instead.", 400);
    }

    const remoteDirectory = path.join(this.dataDir, "releases", site.slug);
    await localProvider.rollback({ releasePath: target.releasePath, remoteDirectory });

    const record = await this.recordDeployment({
      siteId: site.id,
      revisionId: target.revisionId,
      revisionNumber: target.revisionNumber,
      kind: "rollback",
      status: "rolled-back",
      target: "local",
      releasePath: target.releasePath,
      buildIssues: [],
      createdByUserId: actor.id
    });

    await this.setProductionRevision(site.id, target.revisionId);
    return record;
  }

  async list(siteId?: string): Promise<DeploymentRecord[]> {
    const state = await this.stateStore.read();
    const deployments = siteId ? state.deployments.filter((item) => item.siteId === siteId) : state.deployments;
    return deployments.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async setProductionRevision(siteId: string, revisionId: string): Promise<void> {
    await this.stateStore.update((nextState) => {
      const siteRecord = nextState.sites.find((item) => item.id === siteId);
      if (siteRecord) siteRecord.productionRevisionId = revisionId;
    });
  }

  private async recordDeployment(input: Omit<DeploymentRecord, "id" | "createdAt">): Promise<DeploymentRecord> {
    const record: DeploymentRecord = { ...input, id: id("deploy"), createdAt: new Date().toISOString() };
    await this.stateStore.update((state) => {
      state.deployments.push(record);
    });
    return record;
  }
}

function productionBaseUrl(site: SiteRecord): string | undefined {
  if (!site.metadata.domain) return undefined;
  const protocol = site.metadata.https ? "https" : "http";
  return `${protocol}://${site.metadata.domain}`;
}

function summarizeIssues(issues: BuildIssue[]): Array<{ class: "error" | "warning"; code: string; message: string }> {
  return issues.map((issue) => ({ class: issue.class, code: issue.code, message: issue.message }));
}
