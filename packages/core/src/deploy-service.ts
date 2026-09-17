import path from "node:path";
import { buildSite, type BuildIssue } from "@igle/build";
import { AaPanelProvider, LocalReleaseDeploymentProvider, type AaPanelDnsCheck, type AaPanelSiteSummary } from "@igle/deployer";
import { assertCan, IgleError, type Actor } from "@igle/shared";
import { RevisionService } from "./revision-service.js";
import { ServerService } from "./server-service.js";
import { JsonStateStore, id } from "./state-store.js";
import type { DeploymentRecord, ServerRecord, SiteRecord, SiteRevisionRecord } from "./types.js";

const localProvider = new LocalReleaseDeploymentProvider();

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
    if (server.restricted && !actor.canDeployRestricted) {
      throw new IgleError("FORBIDDEN_RESTRICTED_SERVER", `"${server.name}" is a restricted server — only administrators granted access can deploy to it.`, 403);
    }
    return server;
  }

  async testAaPanelConnection(serverId: string, actor: Actor): Promise<{ ok: boolean; siteCount?: number; error?: string }> {
    const server = await this.serverService.getInternal(serverId);
    if (!server) return { ok: false, error: "Server was not found." };
    if (server.restricted && !actor.canDeployRestricted) return { ok: false, error: "You don't have access to this restricted server." };
    return new AaPanelProvider(server).testConnection();
  }

  async listAaPanelSites(serverId: string, actor: Actor, search?: string): Promise<AaPanelSiteSummary[]> {
    const server = await this.requireSelectableServer(serverId, actor);
    return new AaPanelProvider(server).listSites(search);
  }

  async findExistingAaPanelSite(serverId: string, actor: Actor, domain: string): Promise<AaPanelSiteSummary | undefined> {
    const server = await this.serverService.getInternal(serverId);
    if (!server || (server.restricted && !actor.canDeployRestricted)) return undefined;
    return new AaPanelProvider(server).findExistingSite(domain);
  }

  async checkAaPanelDns(serverId: string, actor: Actor, domain: string): Promise<AaPanelDnsCheck> {
    const server = await this.requireSelectableServer(serverId, actor);
    return new AaPanelProvider(server).checkDomainDns(domain);
  }

  private async requireSelectableServer(serverId: string, actor: Actor): Promise<ServerRecord> {
    const server = await this.serverService.getInternal(serverId);
    if (!server) throw new IgleError("SERVER_NOT_FOUND", "Server was not found.", 404);
    if (server.restricted && !actor.canDeployRestricted) {
      throw new IgleError("FORBIDDEN_RESTRICTED_SERVER", `"${server.name}" is a restricted server — only administrators granted access can use it.`, 403);
    }
    return server;
  }

  async deploy(site: SiteRecord, actor: Actor): Promise<DeploymentRecord> {
    assertCan(actor, "sites.deploy", site.id);
    const revision = await this.revisionService.latest(site.id);
    if (!revision) throw new IgleError("NO_REVISION", "This site has no revisions to deploy yet.", 400);

    if (site.metadata.deploymentTarget === "aapanel") {
      const server = await this.resolveServerForDeploy(site, actor);
      return this.deployToAaPanel(site, revision, server, actor);
    }
    return this.deployLocally(site, revision, actor);
  }

  private async deployLocally(
    site: SiteRecord,
    revision: SiteRevisionRecord,
    actor: Actor
  ): Promise<DeploymentRecord> {
    const buildsRoot = path.join(this.dataDir, "builds");
    const baseUrl = productionBaseUrl(site);
    const result = await buildSite({
      siteId: site.id,
      repoPath: site.repoPath,
      commitSha: revision.commitSha,
      buildsRoot,
      ...(baseUrl ? { productionBaseUrl: baseUrl } : {})
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
    actor: Actor
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
      ...(baseUrl ? { productionBaseUrl: baseUrl } : {})
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

    const provider = new AaPanelProvider(server);
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
