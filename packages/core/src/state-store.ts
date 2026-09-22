import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CoreState, TaskRecord } from "./types.js";

/** Shape of a pre-rename TicketRecord, as it may still exist in an old state.json on disk. */
interface LegacyTicketRecord {
  id: string;
  siteId?: string;
  title: string;
  description: string;
  specialistType: TaskRecord["category"];
  priority: TaskRecord["priority"];
  status: TaskRecord["status"];
  deadline?: string;
  assigneeId?: string;
  comments: TaskRecord["comments"];
  createdAt: string;
  updatedAt: string;
}

export class JsonStateStore {
  private readonly filePath: string;

  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, "state.json");
  }

  async read(): Promise<CoreState> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const state = JSON.parse(raw) as CoreState;
      // Migration: tickets renamed to tasks (with a category/checklist/attachments/activity/
      // archive expansion) — map any pre-rename data over once, then drop the old key so it
      // isn't silently re-persisted alongside `tasks` on the next write.
      const legacyTickets = (state as unknown as { tickets?: LegacyTicketRecord[] }).tickets;
      if (legacyTickets && !state.tasks) {
        state.tasks = legacyTickets.map((ticket) => ({
          id: ticket.id,
          siteId: ticket.siteId,
          title: ticket.title,
          description: ticket.description,
          category: ticket.specialistType,
          priority: ticket.priority,
          status: ticket.status,
          deadline: ticket.deadline,
          assigneeId: ticket.assigneeId,
          creatorId: undefined,
          comments: ticket.comments,
          checklist: [],
          attachments: [],
          activity: [],
          archivedAt: undefined,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt
        }));
      }
      delete (state as { tickets?: unknown }).tickets;
      state.tasks ??= [];
      state.notifications ??= [];
      state.deployments ??= [];
      state.servers ??= [];
      state.affiliateLinks ??= {};
      state.pendingTwoFactor ??= [];
      state.cloudflareAccounts ??= [];
      state.vultrAccounts ??= [];
      state.domains ??= [];
      // Restricted-server access used to be an independent per-user grant (canDeployRestricted);
      // it's now derived purely from role (administrator-only) at Actor-construction time in
      // AuthService.getActorForSession, so the stale stored field is dropped rather than migrated.
      for (const user of state.users) {
        delete (user as { canDeployRestricted?: unknown }).canDeployRestricted;
        user.tags ??= [];
      }
      // Migration: every server was an aaPanel server before CloudPanel/Vultr support existed.
      for (const server of state.servers) {
        server.kind ??= "aapanel";
      }
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        sites: [],
        revisions: [],
        pages: [],
        users: [],
        invites: [],
        sessions: [],
        drafts: [],
        jobs: [],
        tasks: [],
        notifications: [],
        deployments: [],
        servers: [],
        affiliateLinks: {},
        pendingTwoFactor: [],
        cloudflareAccounts: [],
        vultrAccounts: [],
        domains: []
      };
    }
  }

  async write(state: CoreState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  async update<T>(mutate: (state: CoreState) => T | Promise<T>): Promise<T> {
    const state = await this.read();
    const result = await mutate(state);
    await this.write(state);
    return result;
  }
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
