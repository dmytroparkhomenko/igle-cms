import { assertCan, resolveInside, type Actor } from "@igle/shared";
import { JsonStateStore, id } from "./state-store.js";
import type { DraftRecord, SiteRecord } from "./types.js";

export class DraftService {
  constructor(private readonly stateStore: JsonStateStore) {}

  async save(site: SiteRecord, input: { userId: string; filePath: string; baseHash: string; content: string }, actor: Actor): Promise<DraftRecord> {
    assertCan(actor, "sites.edit", site.id);
    resolveInside(site.repoPath, input.filePath);
    const now = new Date().toISOString();
    const draft: DraftRecord = {
      id: id("draft"),
      siteId: site.id,
      userId: input.userId,
      filePath: input.filePath,
      baseHash: input.baseHash,
      content: input.content,
      updatedAt: now
    };
    await this.stateStore.update((state) => {
      state.drafts = state.drafts.filter(
        (item) => !(item.siteId === site.id && item.userId === input.userId && item.filePath === input.filePath)
      );
      state.drafts.push(draft);
    });
    return draft;
  }

  async get(site: SiteRecord, userId: string, filePath: string, actor: Actor): Promise<DraftRecord | undefined> {
    assertCan(actor, "sites.edit", site.id);
    resolveInside(site.repoPath, filePath);
    const state = await this.stateStore.read();
    return state.drafts.find((draft) => draft.siteId === site.id && draft.userId === userId && draft.filePath === filePath);
  }

  async discard(site: SiteRecord, userId: string, filePath: string, actor: Actor): Promise<void> {
    assertCan(actor, "sites.edit", site.id);
    await this.stateStore.update((state) => {
      state.drafts = state.drafts.filter((draft) => !(draft.siteId === site.id && draft.userId === userId && draft.filePath === filePath));
    });
  }
}
