import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CloudflareAccountService, DomainService, JsonStateStore, RevisionService, ScriptService, ServerService, SiteService, id } from "@igle/core";
import type { Actor } from "@igle/shared";

const admin: Actor = { id: "admin", email: "admin@example.com", role: "administrator" };

describe("DomainService.assignToSite", () => {
  it("turns https on for the site, since a Cloudflare-connected domain is always proxied over https at the edge", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "igle-test-"));
    const stateStore = new JsonStateStore(dataDir);
    const revisionService = new RevisionService(stateStore);
    const scriptService = new ScriptService(revisionService);
    const siteService = new SiteService(dataDir, stateStore, revisionService, scriptService);
    const cloudflareAccountService = new CloudflareAccountService(stateStore);
    const serverService = new ServerService(stateStore);
    const domainService = new DomainService(stateStore, cloudflareAccountService, serverService, siteService);

    const site = await siteService.createBlankSite({ name: "Glued Site", slug: "glued-site" }, admin);
    // New sites already default to https:true, so explicitly turn it off first — the realistic
    // case this guards is a site where https was off for any reason before its domain got
    // connected through Cloudflare (which always proxies over https at the edge regardless).
    await siteService.updateSettings(site, { https: false }, admin);
    expect((await siteService.get(site.id, admin))?.metadata.https).toBe(false);

    const server = await serverService.add(
      { name: "VPS", kind: "aapanel", restricted: false, baseUrl: "http://203.0.113.10:8888", apiKey: "k" },
      admin
    );

    // Seeds a DomainRecord directly (as if connect() had already run against a real Cloudflare
    // account) rather than going through connect() itself, which makes a real network call.
    const domainId = id("domain");
    await stateStore.update((state) => {
      state.domains.push({
        id: domainId,
        domain: "glued.example",
        cloudflareAccountId: "cf-fake",
        serverId: server.id,
        zoneActive: true,
        status: "dns_configured",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });

    await domainService.assignToSite(domainId, site.id, admin);

    const updated = await siteService.get(site.id, admin);
    expect(updated?.metadata.domain).toBe("glued.example");
    expect(updated?.metadata.https).toBe(true);
    expect(updated?.metadata.deploymentTarget).toBe("aapanel");
    expect(updated?.metadata.serverId).toBe(server.id);
  });
});
