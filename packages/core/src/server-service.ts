import { assertCan, IgleError, type Actor } from "@igle/shared";
import { writeSiteMetadata } from "./metadata-store.js";
import { JsonStateStore, id } from "./state-store.js";
import type { ServerRecord } from "./types.js";

export interface ServerSummary {
  id: string;
  name: string;
  baseUrl: string;
  restricted: boolean;
  publicIp?: string | undefined;
  /** Never the raw key — last 4 characters only, for the admin to recognize which key is registered. */
  apiKeyPreview: string;
  siteCount: number;
  createdAt: string;
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
        baseUrl: server.baseUrl,
        restricted: server.restricted,
        publicIp: server.publicIp,
        apiKeyPreview: maskKey(server.apiKey),
        siteCount: state.sites.filter((site) => site.metadata.serverId === server.id).length,
        createdAt: server.createdAt
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** For deploy-time / site-settings use — filters out servers the actor isn't allowed to touch if restricted. Never exposes the raw apiKey. */
  async listSelectable(actor: Actor): Promise<Array<{ id: string; name: string; baseUrl: string; restricted: boolean }>> {
    const state = await this.stateStore.read();
    return state.servers
      .filter((server) => !server.restricted || actor.canDeployRestricted)
      .map((server) => ({ id: server.id, name: server.name, baseUrl: server.baseUrl, restricted: server.restricted }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Internal use only (DeployService) — resolves the real record including the API key. No actor check; callers must already have verified deploy permission for the site. */
  async getInternal(serverId: string): Promise<ServerRecord | undefined> {
    const state = await this.stateStore.read();
    return state.servers.find((server) => server.id === serverId);
  }

  async add(
    input: { name: string; baseUrl: string; apiKey: string; restricted: boolean; publicIp?: string },
    actor: Actor
  ): Promise<ServerRecord> {
    assertCan(actor, "servers.manage");
    const name = input.name.trim();
    const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
    const apiKey = input.apiKey.trim();
    if (!name) throw new IgleError("VALIDATION_ERROR", "Server name is required.", 400);
    if (!/^https?:\/\/.+/.test(baseUrl)) throw new IgleError("VALIDATION_ERROR", "Base URL must start with http:// or https://.", 400);
    if (!apiKey) throw new IgleError("VALIDATION_ERROR", "API key is required.", 400);
    const publicIp = input.publicIp?.trim() || detectIpFromBaseUrl(baseUrl);

    const server: ServerRecord = {
      id: id("server"),
      name,
      baseUrl,
      apiKey,
      restricted: input.restricted,
      ...(publicIp ? { publicIp } : {}),
      createdAt: new Date().toISOString()
    };
    await this.stateStore.update((state) => {
      state.servers.push(server);
    });
    return server;
  }

  /** Idempotent bootstrap for the legacy single-server env var config — creates a record only if none with this baseUrl exists yet. Called at startup, no actor available. */
  async ensureLegacyServer(name: string, baseUrl: string, apiKey: string): Promise<ServerRecord> {
    const cleanBaseUrl = baseUrl.trim().replace(/\/$/, "");
    const state = await this.stateStore.read();
    const existing = state.servers.find((server) => server.baseUrl === cleanBaseUrl);
    if (existing) return existing;

    const server: ServerRecord = { id: id("server"), name, baseUrl: cleanBaseUrl, apiKey: apiKey.trim(), restricted: false, createdAt: new Date().toISOString() };
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
    input: { name?: string; baseUrl?: string; apiKey?: string; restricted?: boolean; publicIp?: string },
    actor: Actor
  ): Promise<void> {
    assertCan(actor, "servers.manage");
    await this.stateStore.update((state) => {
      const server = state.servers.find((item) => item.id === serverId);
      if (!server) throw new IgleError("SERVER_NOT_FOUND", "Server was not found.", 404);
      if (input.name?.trim()) server.name = input.name.trim();
      if (input.baseUrl?.trim()) server.baseUrl = input.baseUrl.trim().replace(/\/$/, "");
      if (input.apiKey?.trim()) server.apiKey = input.apiKey.trim();
      if (input.restricted !== undefined) server.restricted = input.restricted;
      if (input.publicIp?.trim()) server.publicIp = input.publicIp.trim();
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

function maskKey(apiKey: string): string {
  if (apiKey.length <= 4) return "••••";
  return `••••${apiKey.slice(-4)}`;
}

/** baseUrl is the aaPanel *panel* address (often on a non-standard port) — when its host happens to be a plain IPv4 literal, that's usually also the server's real public IP, so it's a reasonable default for a domain's DNS record. Not reliable when the panel sits behind its own hostname; the admin can always override it. */
function detectIpFromBaseUrl(baseUrl: string): string | undefined {
  try {
    const host = new URL(baseUrl).hostname;
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ? host : undefined;
  } catch {
    return undefined;
  }
}
