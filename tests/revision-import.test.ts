import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ImportService, JsonStateStore, RevisionService, SEOService, SiteService } from "@igle/core";
import type { Actor } from "@igle/shared";

const admin: Actor = { id: "admin", email: "admin@example.com", role: "administrator" };

describe("revision and import services", () => {
  it("creates a blank site with revision #1 backed by a commit", async () => {
    const runtime = await testRuntime();
    const site = await runtime.siteService.createBlankSite({ name: "Demo", slug: "demo" }, admin);
    const revisions = await runtime.revisionService.list(site.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.revisionNumber).toBe(1);
    expect((await runtime.revisionService.integrity(site)).ok).toBe(true);
  });

  it("imports a static directory, edits SEO, compares revisions, and restores history", async () => {
    const runtime = await testRuntime();
    const site = await runtime.siteService.createBlankSite({ name: "Imported", slug: "imported" }, admin);
    const fixture = path.resolve(process.cwd(), "fixtures/site-basic");
    const imported = await runtime.importService.importDirectory(site, fixture, admin);
    expect(imported.revisionNumber).toBe(2);
    expect(imported.report.pagesFound).toBe(2);

    const state = await runtime.stateStore.read();
    const page = state.pages.find((item) => item.siteId === site.id && item.filePath === "index.html");
    expect(page?.seoTitle).toBe("Original Home Title");

    const edited = await runtime.seoService.updateFields(site, page!.id, { seoTitle: "Updated Home Title" }, admin);
    expect(edited.revisionNumber).toBe(3);
    const diff = await runtime.revisionService.compare(site, 2, 3);
    expect(diff).toContain("-    <title>Original Home Title</title>");
    expect(diff).toContain("+    <title>Updated Home Title</title>");

    const restored = await runtime.revisionService.restore(site, 2, { id: admin.id, name: admin.email, email: admin.email });
    expect(restored.revisionNumber).toBe(4);
    expect((await runtime.revisionService.integrity(site)).ok).toBe(true);
  });

  it("preserves an already-assigned domain across a settings save that doesn't mention it", async () => {
    const runtime = await testRuntime();
    const site = await runtime.siteService.createBlankSite({ name: "Domain Site", slug: "domain-site" }, admin);
    await runtime.siteService.updateSettings(site, { domain: "example.com" }, admin);
    expect(site.metadata.domain).toBe("example.com");

    // The real Site Settings form has no domain field at all (domain is assigned separately via
    // DomainService) — this is exactly that shape of call, and must not touch domain.
    await runtime.siteService.updateSettings(site, { name: "Domain Site", https: true }, admin);
    expect(site.metadata.domain).toBe("example.com");

    // An explicit empty string is still how a caller clears it on purpose.
    await runtime.siteService.updateSettings(site, { domain: "" }, admin);
    expect(site.metadata.domain).toBeUndefined();
  });

  it("never lets two concurrent settings saves assign the same domain to different sites", async () => {
    // Reproduces the real production bug: two aaPanel import runs racing on the same server each
    // read state before the other's write landed, and both passed the domain-uniqueness check —
    // leaving two sites with the identical domain. updateSettings() re-checks atomically inside
    // its stateStore.update() mutator specifically to close this window.
    const runtime = await testRuntime();
    const siteA = await runtime.siteService.createBlankSite({ name: "Racer A", slug: "racer-a" }, admin);
    const siteB = await runtime.siteService.createBlankSite({ name: "Racer B", slug: "racer-b" }, admin);

    const results = await Promise.allSettled([
      runtime.siteService.updateSettings(siteA, { domain: "raced.example" }, admin),
      runtime.siteService.updateSettings(siteB, { domain: "raced.example" }, admin)
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const state = await runtime.stateStore.read();
    const holders = state.sites.filter((item) => item.metadata.domain === "raced.example");
    expect(holders).toHaveLength(1);
  });

  it("rejects dangerous import paths", async () => {
    const runtime = await testRuntime();
    expect(runtime.importService.validateEntry("../escape.html").ok).toBe(false);
    expect(runtime.importService.validateEntry("/absolute.html").ok).toBe(false);
    expect(runtime.importService.validateEntry("safe/index.html").ok).toBe(true);
    expect(runtime.importService.validateEntry("link", "symlink").ok).toBe(false);
  });
});

async function testRuntime() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "igle-test-"));
  const stateStore = new JsonStateStore(dataDir);
  const revisionService = new RevisionService(stateStore);
  return {
    stateStore,
    revisionService,
    siteService: new SiteService(dataDir, stateStore, revisionService),
    importService: new ImportService(stateStore, revisionService),
    seoService: new SEOService(stateStore, revisionService)
  };
}
