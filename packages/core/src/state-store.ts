import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CoreState } from "./types.js";

export class JsonStateStore {
  private readonly filePath: string;

  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, "state.json");
  }

  async read(): Promise<CoreState> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as CoreState;
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
        jobs: []
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
