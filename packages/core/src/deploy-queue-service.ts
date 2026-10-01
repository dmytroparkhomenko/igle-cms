import { EventEmitter } from "node:events";
import { id } from "./state-store.js";

export interface DeployQueueEntry {
  id: string;
  siteId: string;
  siteName: string;
  actorEmail: string;
  status: "queued" | "running" | "done" | "failed";
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface DeployQueueSnapshotEntry extends DeployQueueEntry {
  /** 1-indexed position among currently queued entries — undefined once an entry starts running. */
  position?: number;
  /** Rough estimate of how long until this entry starts, derived from recent real deploy durations. Always 0 for a running entry. */
  estimatedStartInMs: number;
}

export interface DeployQueueSnapshot {
  entries: DeployQueueSnapshotEntry[];
  averageDurationMs: number;
}

// No real deploy has finished yet in this process — a deliberately conservative guess (an aaPanel
// deploy — build, upload, SSL check — commonly lands in this range) so the very first queued
// deploy still gets a plausible ETA instead of showing 0s.
const DEFAULT_DURATION_MS = 30_000;
const DURATION_HISTORY_SIZE = 10;
// How long a finished (done/failed) entry stays visible in the queue after completing, so a viewer
// watching the queue actually sees it resolve instead of it vanishing the instant it's done.
const FINISHED_ENTRY_TTL_MS = 15_000;

/**
 * Serializes every call to run() so only one deploy actually executes at a time across the whole
 * process — matches the single aaPanel/CloudPanel API credentials being shared across every site on
 * that server, where two deploys racing each other has no benefit and only adds risk. Entries are
 * in-memory only (gone on restart), the same "single Node process" assumption CollabService and
 * site-lock.ts already document and accept — a queue of in-flight deploys has no reason to survive
 * a restart anyway.
 */
export class DeployQueueService {
  private readonly events = new EventEmitter();
  private entries: DeployQueueEntry[] = [];
  private readonly recentDurationsMs: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  async run<T>(site: { id: string; metadata: { name: string } }, actor: { email: string }, task: () => Promise<T>): Promise<T> {
    const entry: DeployQueueEntry = {
      id: id("deployq"),
      siteId: site.id,
      siteName: site.metadata.name,
      actorEmail: actor.email,
      status: "queued",
      queuedAt: new Date().toISOString()
    };
    this.entries.push(entry);
    this.emit();

    // Chains this run after everything already queued. Reassigning this.chain happens synchronously
    // (no await in between), so concurrent callers each capture a distinct link in the same FIFO
    // chain rather than racing — standard single-process async-mutex-queue shape.
    const previous = this.chain;
    let release!: () => void;
    this.chain = new Promise((resolve) => {
      release = resolve;
    });
    await previous;

    entry.status = "running";
    entry.startedAt = new Date().toISOString();
    this.emit();
    const startedAtMs = Date.now();
    try {
      return await task();
    } catch (error) {
      entry.status = "failed";
      throw error;
    } finally {
      // A throw above already set "failed"; anything else that reached here succeeded.
      if (entry.status === "running") entry.status = "done";
      entry.finishedAt = new Date().toISOString();
      this.recordDuration(Date.now() - startedAtMs);
      this.emit();
      release();
      setTimeout(() => this.prune(entry.id), FINISHED_ENTRY_TTL_MS).unref();
    }
  }

  snapshot(): DeployQueueSnapshot {
    const averageDurationMs =
      this.recentDurationsMs.length > 0
        ? Math.round(this.recentDurationsMs.reduce((sum, value) => sum + value, 0) / this.recentDurationsMs.length)
        : DEFAULT_DURATION_MS;

    const running = this.entries.find((entry) => entry.status === "running");
    const runningRemainingMs = running?.startedAt
      ? Math.max(averageDurationMs - (Date.now() - new Date(running.startedAt).getTime()), 0)
      : 0;

    let queuedSeen = 0;
    const entries = this.entries.map((entry) => {
      if (entry.status !== "queued") {
        return { ...entry, estimatedStartInMs: 0 };
      }
      queuedSeen += 1;
      return {
        ...entry,
        position: queuedSeen,
        estimatedStartInMs: runningRemainingMs + (queuedSeen - 1) * averageDurationMs
      };
    });

    return { entries, averageDurationMs };
  }

  subscribe(listener: (snapshot: DeployQueueSnapshot) => void): () => void {
    this.events.on("update", listener);
    return () => this.events.off("update", listener);
  }

  private recordDuration(durationMs: number): void {
    this.recentDurationsMs.push(durationMs);
    if (this.recentDurationsMs.length > DURATION_HISTORY_SIZE) this.recentDurationsMs.shift();
  }

  private prune(entryId: string): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.id !== entryId);
    if (this.entries.length !== before) this.emit();
  }

  private emit(): void {
    this.events.emit("update", this.snapshot());
  }
}
