import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { IgleError } from "@igle/shared";
import { assertSiteEditable } from "./site-guard.js";
import { JsonStateStore, id } from "./state-store.js";
import type { RevisionSource, SiteRecord, SiteRevisionRecord } from "./types.js";

const execFile = promisify(execFileCallback);

export interface CommitRevisionInput {
  site: SiteRecord;
  source: RevisionSource;
  title: string;
  description?: string | undefined;
  user?: { id: string; name: string; email: string } | undefined;
}

export class RevisionService {
  constructor(private readonly stateStore: JsonStateStore) {}

  async initializeRepository(repoPath: string): Promise<void> {
    await fs.mkdir(repoPath, { recursive: true });
    if (!(await exists(path.join(repoPath, ".git")))) {
      await git(repoPath, ["init", "--initial-branch=main"]);
      await git(repoPath, ["config", "user.name", "Igle System"]);
      await git(repoPath, ["config", "user.email", "system@igle.local"]);
    }
  }

  async commitRevision(input: CommitRevisionInput): Promise<SiteRevisionRecord> {
    const cleanBefore = await this.status(input.site.repoPath);
    if (cleanBefore.length === 0) {
      const existing = await this.latest(input.site.id);
      if (existing) return existing;
    }

    await git(input.site.repoPath, ["add", "--all"]);
    const changed = await this.changedFiles(input.site.repoPath);
    if (changed.length === 0) {
      const existing = await this.latest(input.site.id);
      if (existing) return existing;
    }

    const state = await this.stateStore.read();
    const nextNumber = state.revisions.filter((revision) => revision.siteId === input.site.id).length + 1;
    const message = `Revision #${nextNumber}: ${input.source}: ${input.title}`;
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: input.user?.name ?? "Igle System",
      GIT_AUTHOR_EMAIL: input.user?.email ?? "system@igle.local",
      GIT_COMMITTER_NAME: "Igle CMS",
      GIT_COMMITTER_EMAIL: "system@igle.local"
    };
    await git(input.site.repoPath, ["commit", "-m", message], env);
    const commitSha = (await git(input.site.repoPath, ["rev-parse", "HEAD"])).trim();
    const parent = state.revisions.filter((revision) => revision.siteId === input.site.id).at(-1);
    const record: SiteRevisionRecord = {
      id: id("rev"),
      siteId: input.site.id,
      revisionNumber: nextNumber,
      parentRevisionId: parent?.id,
      commitSha,
      createdByUserId: input.user?.id,
      source: input.source,
      title: input.title,
      description: input.description,
      filesChanged: changed,
      createdAt: new Date().toISOString()
    };

    state.revisions.push(record);
    const site = state.sites.find((item) => item.id === input.site.id);
    if (site) site.headRevisionId = record.id;
    await this.stateStore.write(state);
    return record;
  }

  async latest(siteId: string): Promise<SiteRevisionRecord | undefined> {
    const state = await this.stateStore.read();
    return state.revisions.filter((revision) => revision.siteId === siteId).at(-1);
  }

  async list(siteId: string): Promise<SiteRevisionRecord[]> {
    const state = await this.stateStore.read();
    return state.revisions.filter((revision) => revision.siteId === siteId);
  }

  async compare(site: SiteRecord, fromRevisionNumber: number, toRevisionNumber: number): Promise<string> {
    const revisions = await this.list(site.id);
    const from = revisions.find((revision) => revision.revisionNumber === fromRevisionNumber);
    const to = revisions.find((revision) => revision.revisionNumber === toRevisionNumber);
    if (!from || !to) throw new IgleError("REVISION_NOT_FOUND", "One or both revisions do not exist.", 404);
    return git(site.repoPath, ["diff", "--find-renames", from.commitSha, to.commitSha]);
  }

  async restore(site: SiteRecord, revisionNumber: number, user?: { id: string; name: string; email: string }): Promise<SiteRevisionRecord> {
    assertSiteEditable(site);
    const revision = (await this.list(site.id)).find((item) => item.revisionNumber === revisionNumber);
    if (!revision) throw new IgleError("REVISION_NOT_FOUND", "Revision does not exist.", 404);

    const archive = await gitBuffer(site.repoPath, ["archive", "--format=tar", revision.commitSha]);
    await emptyDirectoryExceptGit(site.repoPath);
    await extractTarWithSystemTar(site.repoPath, archive);
    return this.commitRevision({
      site,
      source: "restore",
      title: `Restored from revision #${revisionNumber}`,
      user
    });
  }

  async integrity(site: SiteRecord): Promise<{ ok: boolean; missing: SiteRevisionRecord[]; headMatchesLatest: boolean }> {
    const revisions = await this.list(site.id);
    const missing: SiteRevisionRecord[] = [];
    for (const revision of revisions) {
      try {
        await git(site.repoPath, ["cat-file", "-e", `${revision.commitSha}^{commit}`]);
      } catch {
        missing.push(revision);
      }
    }

    const head = (await git(site.repoPath, ["rev-parse", "HEAD"])).trim();
    const latest = revisions.at(-1);
    const headMatchesLatest = latest ? head === latest.commitSha : true;
    return { ok: missing.length === 0 && headMatchesLatest, missing, headMatchesLatest };
  }

  private async status(repoPath: string): Promise<string[]> {
    const output = await git(repoPath, ["status", "--porcelain"]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private async changedFiles(repoPath: string): Promise<string[]> {
    const output = await git(repoPath, ["diff", "--cached", "--name-only"]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
}

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await execFile("git", args, { cwd, env, encoding: "utf8", maxBuffer: 1024 * 1024 * 50 });
  return result.stdout;
}

async function gitBuffer(cwd: string, args: string[]): Promise<Buffer> {
  const result = await execFile("git", args, { cwd, encoding: "buffer", maxBuffer: 1024 * 1024 * 50 });
  return result.stdout;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function emptyDirectoryExceptGit(directory: string): Promise<void> {
  const entries = await fs.readdir(directory);
  await Promise.all(
    entries.filter((entry) => entry !== ".git").map((entry) => fs.rm(path.join(directory, entry), { recursive: true, force: true }))
  );
}

async function extractTarWithSystemTar(cwd: string, archive: Buffer): Promise<void> {
  const tempFile = path.join(cwd, `.restore-${randomUUID()}.tar`);
  await fs.writeFile(tempFile, archive);
  try {
    await execFile("tar", ["-xf", tempFile, "-C", cwd]);
  } finally {
    await fs.rm(tempFile, { force: true });
  }
}
