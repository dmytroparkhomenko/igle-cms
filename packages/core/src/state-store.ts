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
  /** Tasks no longer have a category — this legacy field is read (to skip past it) but never mapped forward. */
  specialistType?: string;
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
        // Task tags/categories (developer/designer/seo/copywriter) were removed — team members
        // are now only ever administrator or editor.
        delete (user as { tags?: unknown }).tags;
      }
      for (const task of state.tasks) {
        delete (task as { category?: unknown }).category;
        task.activity = task.activity.filter((entry) => (entry.action as string) !== "category-changed");
      }
      // Migration: every server was an aaPanel server before CloudPanel/Vultr support existed.
      for (const server of state.servers) {
        server.kind ??= "aapanel";
      }
      // Migration: platform/content-lock/domain-gluing fields didn't exist before the aaPanel
      // auto-import feature could pull in dynamic (WordPress/MODX) sites.
      for (const site of state.sites) {
        site.metadata.platform ??= "static";
        site.metadata.contentLocked ??= false;
        site.metadata.hreflangTargets ??= [];
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
        domains: [],
        importRuns: []
      };
    }
  }

  /**
   * Writes via a temp file + rename rather than truncating the target in place. `rename()` is
   * atomic at the filesystem level, so a concurrent `read()` from another process always sees
   * either the complete old file or the complete new one — never a half-written mix. A direct
   * `fs.writeFile` on the real path had no such guarantee: two processes (the web and worker
   * containers both write this same file over a shared volume, with no coordination between them)
   * writing at once could have their bytes physically interleave, corrupting the file — confirmed
   * live in production, where it took the entire app down (every request reads this file).
   */
  async write(state: CoreState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  /**
   * The atomic rename in `write()` stops corruption, but not a second, separate failure mode:
   * two processes each reading the same snapshot, mutating their own copy, and writing back —
   * whichever writes second silently discards the first's changes, no corruption, just quietly
   * lost data. A cross-process lock around the whole read-mutate-write cycle serializes that,
   * the same way in-process code elsewhere in this app already serializes concurrent edits to one
   * site's files (see site-lock.ts's own docstring, which names this exact gap as the thing that
   * would need solving if this ever ran as more than one process — which, via the worker
   * container, it already does).
   */
  async update<T>(mutate: (state: CoreState) => T | Promise<T>): Promise<T> {
    const release = await acquireStateLock(this.filePath);
    try {
      const state = await this.read();
      const result = await mutate(state);
      await this.write(state);
      return result;
    } finally {
      await release();
    }
  }
}

const LOCK_STALE_MS = 30_000;
const LOCK_POLL_MS = 50;
const LOCK_MAX_WAIT_MS = 20_000;

/** A lock a process died holding must not wedge every future write forever — anything older than this is assumed abandoned and stolen. */
async function acquireStateLock(filePath: string): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      // "wx" is O_CREAT|O_EXCL under the hood — atomically fails if the file already exists, so
      // this is a real mutex even across separate OS processes sharing this filesystem.
      const handle = await fs.open(lockPath, "wx");
      await handle.close();
      return () => fs.unlink(lockPath).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const staleSince = await fs.stat(lockPath).catch(() => undefined);
      if (staleSince && Date.now() - staleSince.mtimeMs > LOCK_STALE_MS) {
        await fs.unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() - start > LOCK_MAX_WAIT_MS) {
        throw new Error(`Timed out after ${LOCK_MAX_WAIT_MS}ms waiting for the state.json lock — another process may be stuck holding it.`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
