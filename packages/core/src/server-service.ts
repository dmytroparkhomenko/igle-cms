import { assertCan, IgleError, type Actor } from "@igle/shared";
import { writeSiteMetadata } from "./metadata-store.js";
import { JsonStateStore, id } from "./state-store.js";
import type { ServerKind, ServerRecord } from "./types.js";

export interface ServerSummary {
  id: string;
  name: string;
  kind: ServerKind;
  baseUrl?: string | undefined;
  sshHost?: string | undefined;
  sshPort?: number | undefined;
  sshUsername?: string | undefined;
  restricted: boolean;
  publicIp?: string | undefined;
  /** Never the raw secret — last 4 characters only (aaPanel API key, or a hint that CloudPanel uses a private key), for the admin to recognize which credential is registered. */
  credentialPreview: string;
  siteCount: number;
  createdAt: string;
  autoImportStatus?: ServerRecord["autoImportStatus"];
  autoImportCurrentDomain?: ServerRecord["autoImportCurrentDomain"];
  autoImportSitesChecked?: ServerRecord["autoImportSitesChecked"];
  autoImportSummary?: ServerRecord["autoImportSummary"];
  autoImportExcludedDomains?: ServerRecord["autoImportExcludedDomains"];
}

export interface AddServerInput {
  name: string;
  kind: ServerKind;
  restricted: boolean;
  publicIp?: string | undefined;
  // aaPanel
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  // CloudPanel
  sshHost?: string | undefined;
  sshPort?: number | undefined;
  sshUsername?: string | undefined;
  sshPassword?: string | undefined;
  sshPrivateKey?: string | undefined;
}

export class ServerService {
  constructor(private readonly stateStore: JsonStateStore) {}

  async list(actor: Actor): Promise<ServerSummary[]> {
    assertCan(actor, "servers.manage");
    const state = await this.stateStore.read();
    return state.servers
      .map((server) => ({
        id: server.id,
        name: server.name,
        kind: server.kind,
        baseUrl: server.baseUrl,
        sshHost: server.sshHost,
        sshPort: server.sshPort,
        sshUsername: server.sshUsername,
        restricted: server.restricted,
        publicIp: server.publicIp,
        credentialPreview: credentialPreviewFor(server),
        siteCount: state.sites.filter((site) => site.metadata.serverId === server.id).length,
        createdAt: server.createdAt,
        autoImportStatus: server.autoImportStatus,
        autoImportCurrentDomain: server.autoImportCurrentDomain,
        autoImportSitesChecked: server.autoImportSitesChecked,
        autoImportSummary: server.autoImportSummary,
        autoImportExcludedDomains: server.autoImportExcludedDomains
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * For deploy-time / site-settings use — filters out servers the actor isn't allowed to touch
   * if restricted. Never exposes any credential.
   *
   * Restricted servers are administrator-only. The restricted-access gate is also an
   * affiliate-only concept — pass `forPbn: true` (the site being configured is a PBN site) to
   * include restricted servers regardless of the actor's role.
   */
  async listSelectable(actor: Actor, forPbn = false): Promise<Array<{ id: string; name: string; kind: ServerKind; restricted: boolean }>> {
    const state = await this.stateStore.read();
    return state.servers
      .filter((server) => !server.restricted || actor.role === "administrator" || forPbn)
      .map((server) => ({ id: server.id, name: server.name, kind: server.kind, restricted: server.restricted }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Internal use only (DeployService/DomainService) — resolves the real record including credentials. No actor check; callers must already have verified deploy permission for the site. */
  async getInternal(serverId: string): Promise<ServerRecord | undefined> {
    const state = await this.stateStore.read();
    return state.servers.find((server) => server.id === serverId);
  }

  async add(input: AddServerInput, actor: Actor): Promise<ServerRecord> {
    assertCan(actor, "servers.manage");
    const name = input.name.trim();
    if (!name) throw new IgleError("VALIDATION_ERROR", "Server name is required.", 400);

    let record: ServerRecord;
    if (input.kind === "cloudpanel") {
      const sshHost = input.sshHost?.trim();
      if (!sshHost) throw new IgleError("VALIDATION_ERROR", "SSH host is required.", 400);
      if (!input.sshPassword?.trim() && !input.sshPrivateKey?.trim()) {
        throw new IgleError("VALIDATION_ERROR", "Provide either an SSH password or a private key.", 400);
      }
      const publicIp = input.publicIp?.trim() || (isPlainIp(sshHost) ? sshHost : undefined);
      record = {
        id: id("server"),
        name,
        kind: "cloudpanel",
        sshHost,
        sshPort: input.sshPort || 22,
        sshUsername: input.sshUsername?.trim() || "root",
        ...(input.sshPassword?.trim() ? { sshPassword: input.sshPassword.trim() } : {}),
        ...(input.sshPrivateKey?.trim() ? { sshPrivateKey: input.sshPrivateKey.trim() } : {}),
        restricted: input.restricted,
        ...(publicIp ? { publicIp } : {}),
        createdAt: new Date().toISOString()
      };
    } else {
      const baseUrl = input.baseUrl?.trim().replace(/\/$/, "") ?? "";
      const apiKey = input.apiKey?.trim() ?? "";
      if (!/^https?:\/\/.+/.test(baseUrl)) throw new IgleError("VALIDATION_ERROR", "Base URL must start with http:// or https://.", 400);
      if (!apiKey) throw new IgleError("VALIDATION_ERROR", "API key is required.", 400);
      const publicIp = input.publicIp?.trim() || detectIpFromBaseUrl(baseUrl);
      record = {
        id: id("server"),
        name,
        kind: "aapanel",
        baseUrl,
        apiKey,
        restricted: input.restricted,
        ...(publicIp ? { publicIp } : {}),
        createdAt: new Date().toISOString(),
        // Every site already on the panel gets pulled in automatically — the worker
        // (RemoteSiteImportService) picks this up in the background moments after the server is
        // added, so it's live without the admin having to do anything else.
        autoImportStatus: "pending",
        autoImportActorId: actor.id,
        autoImportActorEmail: actor.email
      };
    }

    await this.stateStore.update((state) => {
      state.servers.push(record);
    });
    return record;
  }

  /** Idempotent bootstrap for the legacy single-server env var config — creates a record only if none with this baseUrl exists yet. Called at startup, no actor available. */
  async ensureLegacyServer(name: string, baseUrl: string, apiKey: string): Promise<ServerRecord> {
    const cleanBaseUrl = baseUrl.trim().replace(/\/$/, "");
    const state = await this.stateStore.read();
    const existing = state.servers.find((server) => server.baseUrl === cleanBaseUrl);
    if (existing) return existing;

    const server: ServerRecord = {
      id: id("server"),
      name,
      kind: "aapanel",
      baseUrl: cleanBaseUrl,
      apiKey: apiKey.trim(),
      restricted: false,
      createdAt: new Date().toISOString()
    };
    const backfilledRepoPaths: string[] = [];
    await this.stateStore.update((next) => {
      next.servers.push(server);
      // Backfill: sites already deployed via the old single-server config had no serverId field.
      for (const site of next.sites) {
        if (site.metadata.deploymentTarget === "aapanel" && !site.metadata.serverId) {
          site.metadata.serverId = server.id;
          backfilledRepoPaths.push(site.repoPath);
        }
      }
    });
    // Keep each site's own git-tracked .igle/site.json consistent with the state store copy —
    // other code (builds, exports) may read metadata from that file directly.
    const backfilledState = await this.stateStore.read();
    await Promise.all(
      backfilledRepoPaths.map((repoPath) => {
        const site = backfilledState.sites.find((item) => item.repoPath === repoPath);
        return site ? writeSiteMetadata(repoPath, site.metadata) : undefined;
      })
    );
    return server;
  }

  async update(
    serverId: string,
    input: {
      name?: string;
      restricted?: boolean;
      publicIp?: string;
      baseUrl?: string;
      apiKey?: string;
      sshHost?: string;
      sshPort?: number;
      sshUsername?: string;
      sshPassword?: string;
      sshPrivateKey?: string;
    },
    actor: Actor
  ): Promise<void> {
    assertCan(actor, "servers.manage");
    await this.stateStore.update((state) => {
      const server = state.servers.find((item) => item.id === serverId);
      if (!server) throw new IgleError("SERVER_NOT_FOUND", "Server was not found.", 404);
      if (input.name?.trim()) server.name = input.name.trim();
      if (input.restricted !== undefined) server.restricted = input.restricted;
      if (input.publicIp?.trim()) server.publicIp = input.publicIp.trim();
      if (server.kind === "aapanel") {
        if (input.baseUrl?.trim()) server.baseUrl = input.baseUrl.trim().replace(/\/$/, "");
        if (input.apiKey?.trim()) server.apiKey = input.apiKey.trim();
      } else {
        if (input.sshHost?.trim()) server.sshHost = input.sshHost.trim();
        if (input.sshPort) server.sshPort = input.sshPort;
        if (input.sshUsername?.trim()) server.sshUsername = input.sshUsername.trim();
        if (input.sshPassword?.trim()) server.sshPassword = input.sshPassword.trim();
        if (input.sshPrivateKey?.trim()) server.sshPrivateKey = input.sshPrivateKey.trim();
      }
    });
  }

  /** Manually (re-)queues an aaPanel server sync — the same background job that runs automatically right after a server is added (see RemoteSiteImportService), for retrying after a failure, picking up new sites added on the panel since, or re-checking already-tracked sites for a platform change (see reclassifyExistingSite). */
  async requestImport(serverId: string, actor: Actor): Promise<void> {
    assertCan(actor, "servers.manage");
    await this.stateStore.update((state) => {
      const server = state.servers.find((item) => item.id === serverId);
      if (!server) throw new IgleError("SERVER_NOT_FOUND", "Server was not found.", 404);
      if (server.kind !== "aapanel") {
        throw new IgleError("VALIDATION_ERROR", "Only aaPanel servers support automatic site import.", 400);
      }
      if (server.autoImportStatus === "running") {
        throw new IgleError("IMPORT_IN_PROGRESS", "An import is already running for this server.", 409);
      }
      server.autoImportStatus = "pending";
      server.autoImportActorId = actor.id;
      server.autoImportActorEmail = actor.email;
      server.autoImportSummary = undefined;
    });
  }

  /** Domains on this panel that auto-import should always skip — e.g. an unrelated app registered as a "site" in aaPanel for its own reasons, not real Igle CMS content. Replaces the whole list. */
  async setAutoImportExclusions(serverId: string, domains: string[], actor: Actor): Promise<void> {
    assertCan(actor, "servers.manage");
    const cleaned = [...new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))];
    await this.stateStore.update((state) => {
      const server = state.servers.find((item) => item.id === serverId);
      if (!server) throw new IgleError("SERVER_NOT_FOUND", "Server was not found.", 404);
      server.autoImportExcludedDomains = cleaned;
    });
  }

  async remove(serverId: string, actor: Actor): Promise<void> {
    assertCan(actor, "servers.manage");
    const state = await this.stateStore.read();
    const inUse = state.sites.some((site) => site.metadata.serverId === serverId);
    if (inUse) {
      throw new IgleError("SERVER_IN_USE", "Move every site off this server before removing it.", 400);
    }
    await this.stateStore.update((next) => {
      next.servers = next.servers.filter((server) => server.id !== serverId);
    });
  }
}

function credentialPreviewFor(server: ServerRecord): string {
  if (server.kind === "cloudpanel") {
    const auth = server.sshPassword ? "password" : server.sshPrivateKey ? "private key" : "no credential set";
    return `${server.sshUsername ?? "root"}@${server.sshHost ?? "?"} (${auth})`;
  }
  const key = server.apiKey ?? "";
  return key.length <= 4 ? "••••" : `••••${key.slice(-4)}`;
}

function isPlainIp(host: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** baseUrl is the aaPanel *panel* address (often on a non-standard port) — when its host happens to be a plain IPv4 literal, that's usually also the server's real public IP, so it's a reasonable default for a domain's DNS record. Not reliable when the panel sits behind its own hostname; the admin can always override it. */
function detectIpFromBaseUrl(baseUrl: string): string | undefined {
  try {
    const host = new URL(baseUrl).hostname;
    return isPlainIp(host) ? host : undefined;
  } catch {
    return undefined;
  }
}
