import { randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Client, type ConnectConfig } from "ssh2";

const execFile = promisify(execFileCallback);

export interface CloudPanelConfig {
  host: string;
  port?: number | undefined;
  username?: string | undefined;
  /** Exactly one of password/privateKey is expected — password wins if both are somehow set. */
  password?: string | undefined;
  privateKey?: string | undefined;
}

export class CloudPanelError extends Error {
  constructor(
    message: string,
    public readonly raw?: unknown
  ) {
    super(message);
    this.name = "CloudPanelError";
  }
}

export interface CloudPanelSite {
  domain: string;
  siteUser: string;
  documentRoot: string;
  created: boolean;
}

/**
 * Talks to a CloudPanel (https://www.cloudpanel.io) server over SSH and runs its `clpctl` CLI —
 * CloudPanel, unlike aaPanel, has no remote REST API, so this is the only integration surface
 * available. Each call opens a fresh SSH connection (simplicity over connection pooling; these
 * are low-frequency, human-triggered actions — deploy, issue SSL — not a hot path).
 *
 * CloudPanel gives every site its own Linux user and a document root at
 * /home/<siteUser>/htdocs/<domain> — files are uploaded as root (this provider's own SSH user)
 * then chowned to the site user so CloudPanel's own nginx (which runs as that user) can serve
 * them. There's no documented `site:list`/`site:exists` command (a long-requested but still-open
 * CloudPanel feature request), so existence is checked directly via the filesystem instead of
 * parsing clpctl output.
 */
export class CloudPanelProvider {
  constructor(private readonly config: CloudPanelConfig) {}

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.exec("clpctl --version");
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Connection test failed." };
    }
  }

  siteUserFor(domain: string): string {
    const slug = domain
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 28);
    return `igle${slug}`.slice(0, 32);
  }

  documentRootFor(domain: string): string {
    return `/home/${this.siteUserFor(domain)}/htdocs/${domain}`;
  }

  /** Creates the site (its own Linux user + vhost + document root) if it isn't already there. */
  async ensureSite(domain: string): Promise<CloudPanelSite> {
    const siteUser = this.siteUserFor(domain);
    const documentRoot = this.documentRootFor(domain);

    const exists = await this.pathExists(documentRoot);
    if (exists) return { domain, siteUser, documentRoot, created: false };

    const siteUserPassword = randomBytes(18).toString("base64url");
    await this.exec(
      `clpctl site:add:static --domainName=${shellQuote(domain)} --siteUser=${shellQuote(siteUser)} --siteUserPassword=${shellQuote(siteUserPassword)}`
    );

    const createdRoot = await this.pathExists(documentRoot);
    if (!createdRoot) {
      throw new CloudPanelError(`CloudPanel reported success creating ${domain} but its document root doesn't exist.`);
    }
    return { domain, siteUser, documentRoot, created: true };
  }

  /** Zips the build locally, uploads it over SFTP, extracts it remotely, then hands ownership to the site's own user. */
  async deployBuild(buildPath: string, site: CloudPanelSite): Promise<void> {
    const zipPath = path.join(path.dirname(buildPath), `${path.basename(buildPath)}.zip`);
    await fs.rm(zipPath, { force: true });
    try {
      await execFile("zip", ["-rq", zipPath, "."], { cwd: buildPath });
      const remoteZipPath = `/tmp/igle-deploy-${Date.now()}.zip`;

      await this.withConnection(async (conn) => {
        await sftpUpload(conn, zipPath, remoteZipPath);
      });

      await this.exec(`rm -rf ${shellQuote(site.documentRoot)}/* && mkdir -p ${shellQuote(site.documentRoot)}`);
      await this.exec(`unzip -oq ${shellQuote(remoteZipPath)} -d ${shellQuote(site.documentRoot)}`);
      await this.exec(`rm -f ${shellQuote(remoteZipPath)}`);
      await this.exec(`chown -R ${shellQuote(site.siteUser)}:${shellQuote(site.siteUser)} ${shellQuote(site.documentRoot)}`);
    } finally {
      await fs.rm(zipPath, { force: true });
    }
  }

  /** One clpctl call issues and installs a Let's Encrypt certificate for the domain — CloudPanel handles renewal itself afterward. */
  async applySSL(domain: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.exec(`clpctl lets-encrypt:install:certificate --domainName=${shellQuote(domain)}`);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "SSL request failed." };
    }
  }

  async smokeTest(domain: string, https: boolean): Promise<{ ok: boolean; failures: string[] }> {
    const protocol = https ? "https" : "http";
    try {
      const response = await fetch(`${protocol}://${domain}/`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return { ok: false, failures: [`${protocol}://${domain}/ returned HTTP ${response.status}`] };
      return { ok: true, failures: [] };
    } catch (error) {
      return { ok: false, failures: [error instanceof Error ? error.message : "Smoke test request failed."] };
    }
  }

  private async pathExists(remotePath: string): Promise<boolean> {
    try {
      await this.exec(`test -d ${shellQuote(remotePath)}`);
      return true;
    } catch {
      return false;
    }
  }

  private async exec(command: string): Promise<string> {
    return this.withConnection(
      (conn) =>
        new Promise<string>((resolve, reject) => {
          conn.exec(command, (err, stream) => {
            if (err) return reject(new CloudPanelError(err.message, err));
            let stdout = "";
            let stderr = "";
            stream
              .on("close", (code: number) => {
                if (code === 0) return resolve(stdout.trim());
                reject(new CloudPanelError(`Command failed (exit ${code}): ${stderr.trim() || stdout.trim() || command}`));
              })
              .on("data", (chunk: Buffer) => {
                stdout += chunk.toString("utf8");
              })
              .stderr.on("data", (chunk: Buffer) => {
                stderr += chunk.toString("utf8");
              });
          });
        })
    );
  }

  private async withConnection<T>(fn: (conn: Client) => Promise<T>): Promise<T> {
    const conn = new Client();
    const connectConfig: ConnectConfig = {
      host: this.config.host,
      port: this.config.port ?? 22,
      username: this.config.username ?? "root",
      readyTimeout: 20000,
      ...(this.config.password ? { password: this.config.password } : {}),
      ...(!this.config.password && this.config.privateKey ? { privateKey: this.config.privateKey } : {})
    };
    try {
      await new Promise<void>((resolve, reject) => {
        conn
          .on("ready", resolve)
          .on("error", (err) => reject(new CloudPanelError(`SSH connection failed: ${err.message}`, err)))
          .connect(connectConfig);
      });
      return await fn(conn);
    } finally {
      conn.end();
    }
  }
}

function sftpUpload(conn: Client, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(new CloudPanelError(`SFTP failed: ${err.message}`, err));
      sftp.fastPut(localPath, remotePath, (uploadErr) => {
        if (uploadErr) return reject(new CloudPanelError(`Upload failed: ${uploadErr.message}`, uploadErr));
        resolve();
      });
    });
  });
}

/** Single-quotes a value for safe use in a remote shell command, escaping any embedded single quotes. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
