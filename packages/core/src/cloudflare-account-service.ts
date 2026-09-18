import { CloudflareProvider } from "@igle/deployer";
import { assertCan, IgleError, type Actor } from "@igle/shared";
import { JsonStateStore, id } from "./state-store.js";
import type { CloudflareAccountRecord } from "./types.js";

export interface CloudflareAccountSummary {
  id: string;
  name: string;
  accountId?: string | undefined;
  /** Never the raw token — last 4 characters only. */
  apiTokenPreview: string;
  domainCount: number;
  createdAt: string;
}

/** Registered Cloudflare accounts — kept separate from Servers since the whole point of spreading domains across several accounts is that no two domains share an obvious ownership signal. */
export class CloudflareAccountService {
  constructor(private readonly stateStore: JsonStateStore) {}

  async list(actor: Actor): Promise<CloudflareAccountSummary[]> {
    assertCan(actor, "domains.manage");
    const state = await this.stateStore.read();
    return state.cloudflareAccounts
      .map((account) => ({
        id: account.id,
        name: account.name,
        accountId: account.accountId,
        apiTokenPreview: maskToken(account.apiToken),
        domainCount: state.domains.filter((domain) => domain.cloudflareAccountId === account.id).length,
        createdAt: account.createdAt
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** For pickers — no token exposed. */
  async listSelectable(actor: Actor): Promise<Array<{ id: string; name: string }>> {
    assertCan(actor, "domains.manage");
    const state = await this.stateStore.read();
    return state.cloudflareAccounts.map((account) => ({ id: account.id, name: account.name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Internal use only (DomainService) — resolves the real record including the token. No actor check; callers must already have verified domains.manage. */
  async getInternal(accountId: string): Promise<CloudflareAccountRecord | undefined> {
    const state = await this.stateStore.read();
    return state.cloudflareAccounts.find((account) => account.id === accountId);
  }

  async add(input: { name: string; apiToken: string; accountId?: string }, actor: Actor): Promise<CloudflareAccountRecord> {
    assertCan(actor, "domains.manage");
    const name = input.name.trim();
    const apiToken = input.apiToken.trim();
    if (!name) throw new IgleError("VALIDATION_ERROR", "Account name is required.", 400);
    if (!apiToken) throw new IgleError("VALIDATION_ERROR", "API token is required.", 400);

    const record: CloudflareAccountRecord = {
      id: id("cfacct"),
      name,
      apiToken,
      ...(input.accountId?.trim() ? { accountId: input.accountId.trim() } : {}),
      createdAt: new Date().toISOString()
    };
    await this.stateStore.update((state) => {
      state.cloudflareAccounts.push(record);
    });
    return record;
  }

  async testConnection(accountId: string, actor: Actor): Promise<{ ok: boolean; zoneCount?: number; error?: string }> {
    assertCan(actor, "domains.manage");
    const account = await this.getInternal(accountId);
    if (!account) throw new IgleError("CLOUDFLARE_ACCOUNT_NOT_FOUND", "Cloudflare account was not found.", 404);
    return new CloudflareProvider({ apiToken: account.apiToken, accountId: account.accountId }).testConnection();
  }

  async remove(accountId: string, actor: Actor): Promise<void> {
    assertCan(actor, "domains.manage");
    const state = await this.stateStore.read();
    const inUse = state.domains.some((domain) => domain.cloudflareAccountId === accountId);
    if (inUse) throw new IgleError("CLOUDFLARE_ACCOUNT_IN_USE", "Disconnect every domain on this account before removing it.", 400);
    await this.stateStore.update((next) => {
      next.cloudflareAccounts = next.cloudflareAccounts.filter((account) => account.id !== accountId);
    });
  }
}

function maskToken(apiToken: string): string {
  if (apiToken.length <= 4) return "••••";
  return `••••${apiToken.slice(-4)}`;
}
