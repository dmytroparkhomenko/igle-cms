import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSite } from "@igle/build";
import { ImportService, JsonStateStore, RevisionService, SiteService, writeJson } from "@igle/core";
import type { Actor } from "@igle/shared";

const admin: Actor = { id: "admin", email: "admin@example.com", role: "administrator" };

describe("build pipeline", () => {
  it("materializes a revision, excludes .igle, injects production scripts, and writes sitemap/robots", async () => {
    const runtime = await testRuntime();
    const site = await runtime.siteService.createBlankSite({ name: "Build Site", slug: "build-site" }, admin);
    await runtime.importService.importDirectory(site, path.resolve(process.cwd(), "fixtures/site-basic"), admin);
    await writeJson(path.join(site.repoPath, ".igle", "scripts.json"), {
      scripts: [
        {
          id: "script_1",
          name: "Analytics",
          environment: "production",
          placement: "head-end",
          enabled: true,
          pages: { mode: "all", paths: [], patterns: [] },
          code: "<script>window.analytics=true</script>"
        },
        {
          id: "script_2",
          name: "Preview only",
          environment: "preview",
          placement: "body-end",
          enabled: true,
          pages: { mode: "all", paths: [], patterns: [] },
          code: "<script>window.previewOnly=true</script>"
        }
      ]
    });
    const revision = await runtime.revisionService.commitRevision({ site, source: "custom-script", title: "Configured scripts" });
    const result = await buildSite({
      siteId: site.id,
      repoPath: site.repoPath,
      commitSha: revision.commitSha,
      buildsRoot: path.join(runtime.dataDir, "builds"),
      productionBaseUrl: "https://example.com"
    });

    const builtHtml = await fs.readFile(path.join(result.buildPath, "index.html"), "utf8");
    expect(builtHtml).toContain("window.analytics=true");
    expect(builtHtml).not.toContain("window.previewOnly=true");
    await expect(fs.access(path.join(result.buildPath, ".igle"))).rejects.toThrow();
    expect(await fs.readFile(path.join(result.buildPath, "robots.txt"), "utf8")).toContain("Sitemap: https://example.com/sitemap.xml");
    expect(await fs.readFile(path.join(result.buildPath, "sitemap.xml"), "utf8")).toContain("<loc>https://example.com/</loc>");
    expect(result.manifest.some((entry) => entry.path === "index.html")).toBe(true);
  });

  it("reports forbidden footprint markers as build errors", async () => {
    const runtime = await testRuntime();
    const site = await runtime.siteService.createBlankSite({ name: "Footprint Site", slug: "footprint-site" }, admin);
    await fs.writeFile(path.join(site.repoPath, "index.html"), "<html><body data-igle-test=\"x\">Bad</body></html>", "utf8");
    const revision = await runtime.revisionService.commitRevision({ site, source: "code-editor", title: "Injected marker" });
    const result = await buildSite({
      siteId: site.id,
      repoPath: site.repoPath,
      commitSha: revision.commitSha,
      buildsRoot: path.join(runtime.dataDir, "builds")
    });
    expect(result.issues.some((issue) => issue.class === "error" && issue.code === "FOOTPRINT_MARKER")).toBe(true);
  });
});

async function testRuntime() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "igle-build-test-"));
  const stateStore = new JsonStateStore(dataDir);
  const revisionService = new RevisionService(stateStore);
  return {
    dataDir,
    stateStore,
    revisionService,
    siteService: new SiteService(dataDir, stateStore, revisionService),
    importService: new ImportService(stateStore, revisionService)
  };
}
