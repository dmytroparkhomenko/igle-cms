import { EventEmitter } from "node:events";
import { JsonStateStore, id } from "./state-store.js";
import type { JobRecord } from "./types.js";

export class JobService {
  private readonly events = new EventEmitter();

  constructor(private readonly stateStore: JsonStateStore) {}

  async create(type: string, message = "Queued"): Promise<JobRecord> {
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: id("job"),
      type,
      status: "queued",
      progress: 0,
      message,
      logs: [message],
      createdAt: now,
      updatedAt: now
    };
    await this.stateStore.update((state) => {
      state.jobs.push(job);
    });
    this.events.emit(job.id, job);
    return job;
  }

  async update(jobId: string, patch: Partial<Pick<JobRecord, "status" | "progress" | "message">>): Promise<JobRecord> {
    let next: JobRecord | undefined;
    await this.stateStore.update((state) => {
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job) return;
      Object.assign(job, patch, { updatedAt: new Date().toISOString() });
      if (patch.message) job.logs.push(patch.message);
      next = job;
    });
    if (!next) throw new Error(`Job ${jobId} was not found.`);
    this.events.emit(jobId, next);
    return next;
  }

  async demoJob(): Promise<JobRecord> {
    const job = await this.create("demo", "Demo job started.");
    void this.runDemo(job.id);
    return job;
  }

  subscribe(jobId: string, listener: (job: JobRecord) => void): () => void {
    this.events.on(jobId, listener);
    return () => this.events.off(jobId, listener);
  }

  async get(jobId: string): Promise<JobRecord | undefined> {
    const state = await this.stateStore.read();
    return state.jobs.find((job) => job.id === jobId);
  }

  private async runDemo(jobId: string): Promise<void> {
    await this.update(jobId, { status: "running", progress: 10, message: "Worker picked up the demo job." });
    await delay(50);
    await this.update(jobId, { status: "running", progress: 60, message: "Demo job checkpoint persisted." });
    await delay(50);
    await this.update(jobId, { status: "success", progress: 100, message: "Demo job completed." });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
