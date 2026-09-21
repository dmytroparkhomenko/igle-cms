import { VultrProvider, type VultrInstance } from "@igle/deployer";
import { assertCan, IgleError, type Actor } from "@igle/shared";
import { JsonStateStore, id } from "./state-store.js";
import type { VultrAccountRecord } from "./types.js";

export interface VultrAccountSummary {
  id: string;
  name: string;
  /** Never the raw token — last 4 characters only. */
  apiTokenPreview: string;
  createdAt: string;
}

/**
 * Registered Vultr accounts — read-only instance discovery only (Vultr's own API has no concept
 * of "websites", just cloud infrastructure), used to import an instance's name/IP into the
 * Servers screen instead of typing them in by hand. Nothing here is referenced again once a
 * Server is registered, so unlike Cloudflare accounts there's no "in use" tracking on removal.
 */
export class VultrAccountService {
  constructor(private readonly stateStore: JsonStateStore) {}

  async list(actor: Actor): Promise<VultrAccountSummary[]> {
    assertCan(actor, "servers.manage");
    const state = await this.stateStore.read();
    return state.vultrAccounts
      .map((account) => ({ id: account.id, name: account.name, apiTokenPreview: maskToken(account.apiToken), createdAt: account.createdAt }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getInternal(accountId: string): Promise<VultrAccountRecord | undefined> {
    const state = await this.stateStore.read();
    return state.vultrAccounts.find((account) => account.id === accountId);
  }

  async add(input: { name: string; apiToken: string }, actor: Actor): Promise<VultrAccountRecord> {
    assertCan(actor, "servers.manage");
    const name = input.name.trim();
    const apiToken = input.apiToken.trim();
    if (!name) throw new IgleError("VALIDATION_ERROR", "Account name is required.", 400);
    if (!apiToken) throw new IgleError("VALIDATION_ERROR", "API token is required.", 400);

    const record: VultrAccountRecord = { id: id("vultracct"), name, apiToken, createdAt: new Date().toISOString() };
    await this.stateStore.update((state) => {
      state.vultrAccounts.push(record);
    });
    return record;
  }

  async testConnection(accountId: string, actor: Actor): Promise<{ ok: boolean; instanceCount?: number; error?: string }> {
    assertCan(actor, "servers.manage");
    const account = await this.getInternal(accountId);
    if (!account) throw new IgleError("VULTR_ACCOUNT_NOT_FOUND", "Vultr account was not found.", 404);
    return new VultrProvider(account.apiToken).testConnection();
  }

  async listInstances(accountId: string, actor: Actor): Promise<VultrInstance[]> {
    assertCan(actor, "servers.manage");
    const account = await this.getInternal(accountId);
    if (!account) throw new IgleError("VULTR_ACCOUNT_NOT_FOUND", "Vultr account was not found.", 404);
    return new VultrProvider(account.apiToken).listInstances();
  }

  async remove(accountId: string, actor: Actor): Promise<void> {
    assertCan(actor, "servers.manage");
    await this.stateStore.update((next) => {
      next.vultrAccounts = next.vultrAccounts.filter((account) => account.id !== accountId);
    });
  }
}

function maskToken(apiToken: string): string {
  if (apiToken.length <= 4) return "••••";
  return `••••${apiToken.slice(-4)}`;
}
