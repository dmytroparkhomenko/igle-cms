import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export * from "./aapanel-provider.js";

export interface DeploymentProvider {
  deploy(input: { buildPath: string; remoteDirectory: string; revisionId: string }): Promise<{ releasePath: string }>;
  rollback(input: { releasePath: string }): Promise<void>;
}

export interface WebServerProvider {
  generateConfig(input: {
    domain: string;
    alternateDomains: string[];
    root: string;
    https: boolean;
    urlStyle: "html-ext" | "clean" | "clean-slash";
  }): string;
}

export class NginxProvider implements WebServerProvider {
  generateConfig(input: {
    domain: string;
    alternateDomains: string[];
    root: string;
    https: boolean;
    urlStyle: "html-ext" | "clean" | "clean-slash";
    redirects?: Array<{ from: string; to: string; status: 301 | 302 | 307 | 308 }>;
  }): string {
    const names = [input.domain, ...input.alternateDomains].map(assertSafeServerName).join(" ");
    const root = assertSafePath(input.root);
    const tryFiles = input.urlStyle === "clean-slash" ? "$uri $uri/ $uri/index.html =404" : "$uri $uri.html $uri/ =404";
    const redirectRules = (input.redirects ?? []).map(nginxRedirect).join("\n");
    return `server {
    listen 80;
    server_name ${names};
    root ${root};
    index index.html;
    server_tokens off;

    gzip on;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/_acme;
    }

${redirectRules}

    location / {
        try_files ${tryFiles};
    }
}
`;
  }
}

export class LocalReleaseDeploymentProvider implements DeploymentProvider {
  async deploy(input: {
    buildPath: string;
    remoteDirectory: string;
    revisionId: string;
    smoke?: { expectedFiles?: string[]; expectedHashes?: Record<string, string>; autoRollback?: boolean };
  }): Promise<{ releasePath: string }> {
    const releaseId = releaseIdFor(input.revisionId);
    const releasesDir = path.join(input.remoteDirectory, "releases");
    const releasePath = path.join(releasesDir, releaseId);
    const currentPath = path.join(input.remoteDirectory, "current");
    const previous = await readCurrentTarget(currentPath);
    await fs.mkdir(releasesDir, { recursive: true });
    await fs.rm(releasePath, { recursive: true, force: true });
    await copyDirectory(input.buildPath, releasePath);
    await switchCurrent(input.remoteDirectory, releasePath);

    const smoke = await smokeTestRelease(releasePath, input.smoke?.expectedFiles, input.smoke?.expectedHashes);
    if (!smoke.ok && input.smoke?.autoRollback !== false && previous) {
      await switchCurrent(input.remoteDirectory, previous);
      throw new Error(`Smoke test failed and deployment was rolled back: ${smoke.failures.join("; ")}`);
    }
    if (!smoke.ok) throw new Error(`Smoke test failed: ${smoke.failures.join("; ")}`);
    return { releasePath };
  }

  async rollback(input: { releasePath: string; remoteDirectory?: string }): Promise<void> {
    const remoteDirectory = input.remoteDirectory ?? path.resolve(input.releasePath, "../..");
    await switchCurrent(remoteDirectory, input.releasePath);
  }
}

export async function smokeTestRelease(
  releasePath: string,
  expectedFiles: string[] = ["index.html", "robots.txt", "sitemap.xml"],
  expectedHashes: Record<string, string> = {}
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  for (const filePath of expectedFiles) {
    const absolutePath = path.join(releasePath, filePath);
    try {
      const content = await fs.readFile(absolutePath);
      const expectedHash = expectedHashes[filePath];
      if (expectedHash && createHash("sha256").update(content).digest("hex") !== expectedHash) {
        failures.push(`${filePath} hash mismatch`);
      }
    } catch {
      failures.push(`${filePath} is missing`);
    }
  }
  return { ok: failures.length === 0, failures };
}

function assertSafeServerName(value: string): string {
  if (!/^[a-z0-9.-]+$/i.test(value)) throw new Error("Invalid server name.");
  return value;
}

function assertSafePath(value: string): string {
  if (!/^\/[a-zA-Z0-9._/@-]+$/.test(value)) throw new Error("Invalid absolute path.");
  return value;
}

function nginxRedirect(redirect: { from: string; to: string; status: 301 | 302 | 307 | 308 }): string {
  if (!/^\/[a-zA-Z0-9/_.,~%-]*$/.test(redirect.from)) throw new Error("Invalid redirect source.");
  if (!/^\/[a-zA-Z0-9/_.,~%?#=&-]*$/.test(redirect.to) && !/^https?:\/\/[a-z0-9.-]+[a-z0-9/_.,~%?#=&:-]*$/i.test(redirect.to)) {
    throw new Error("Invalid redirect target.");
  }
  return `    location = ${redirect.from} {
        return ${redirect.status} ${redirect.to};
    }`;
}

function releaseIdFor(revisionId: string): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  return `${timestamp}-${revisionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16)}`;
}

async function switchCurrent(remoteDirectory: string, releasePath: string): Promise<void> {
  await fs.mkdir(remoteDirectory, { recursive: true });
  const tempLink = path.join(remoteDirectory, `.current-${process.pid}-${Date.now()}`);
  await fs.symlink(releasePath, tempLink);
  await fs.rename(tempLink, path.join(remoteDirectory, "current"));
}

async function readCurrentTarget(currentPath: string): Promise<string | undefined> {
  try {
    return await fs.readlink(currentPath);
  } catch {
    return undefined;
  }
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    if (entry.isFile()) await fs.copyFile(from, to);
  }
}
