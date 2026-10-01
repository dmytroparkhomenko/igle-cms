import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSite } from "@igle/build";
import { ImportService, JsonStateStore, RevisionService, ScriptService, SEOService, SiteService, writeJson } from "@igle/core";
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

  it("injects the site's canonicalDomain into every page except one the CMS itself wrote a canonical for", async () => {
    const runtime = await testRuntime();
    const site = await runtime.siteService.createBlankSite({ name: "Glue Site", slug: "glue-site" }, admin);
    await runtime.importService.importDirectory(site, path.resolve(process.cwd(), "fixtures/site-basic"), admin);
    await runtime.siteService.updateSettings(site, { canonicalDomain: "https://newreg.example" }, admin);

    const pages = (await runtime.stateStore.read()).pages.filter((page) => page.siteId === site.id);
    const aboutPage = pages.find((page) => page.filePath === "about.html")!;
    await runtime.seoService.updateFields(site, aboutPage.id, { canonical: "https://keep-me.example/about.html" }, admin);

    const revision = await runtime.revisionService.latest(site.id);
    const result = await buildSite({
      siteId: site.id,
      repoPath: site.repoPath,
      commitSha: revision!.commitSha,
      buildsRoot: path.join(runtime.dataDir, "builds")
    });
    expect(result.issues.filter((issue) => issue.class === "error")).toEqual([]);

    // index.html imported with its own <link rel="canonical"> already in the raw HTML, but the
    // CMS never wrote it (no lastWrittenHashes.canonical) — canonicalDomain must override it.
    const indexHtml = await fs.readFile(path.join(result.buildPath, "index.html"), "utf8");
    expect(indexHtml).toContain('<link rel="canonical" href="https://newreg.example/">');
    expect(indexHtml).not.toContain("https://example.com/");

    // about.html's canonical WAS written through SeoService — canonicalDomain must leave it alone.
    const aboutHtml = await fs.readFile(path.join(result.buildPath, "about.html"), "utf8");
    expect(aboutHtml).toContain('<link rel="canonical" href="https://keep-me.example/about.html">');
  });

  it("uses explicit hreflangTargets over the implicit mirror partner when both are present", async () => {
    const runtime = await testRuntime();
    const site = await runtime.siteService.createBlankSite({ name: "Hreflang Site", slug: "hreflang-site" }, admin);
    await runtime.importService.importDirectory(site, path.resolve(process.cwd(), "fixtures/site-basic"), admin);
    await runtime.siteService.updateSettings(
      site,
      {
        hreflangTargets: [
          { lang: "es-MX", domain: "https://es.example.com" },
          { lang: "x-default", domain: "https://example.com" }
        ]
      },
      admin
    );

    const revision = await runtime.revisionService.latest(site.id);
    const result = await buildSite({
      siteId: site.id,
      repoPath: site.repoPath,
      commitSha: revision!.commitSha,
      buildsRoot: path.join(runtime.dataDir, "builds"),
      productionBaseUrl: "https://example.com",
      // Present to prove explicit hreflangTargets wins over the implicit mirror partner, not
      // just that hreflang injection runs at all.
      hreflangPartner: { baseUrl: "https://ignored.example", languageTag: "de" }
    });

    const indexHtml = await fs.readFile(path.join(result.buildPath, "index.html"), "utf8");
    expect(indexHtml).toContain('<link rel="alternate" hreflang="en-US" href="https://example.com/">');
    expect(indexHtml).toContain('<link rel="alternate" hreflang="es-MX" href="https://es.example.com/">');
    expect(indexHtml).toContain('<link rel="alternate" hreflang="x-default" href="https://example.com/">');
    expect(indexHtml).not.toContain('hreflang="de"');
  });

  it("writes an Apache .htaccess rewriting clean URLs to their .html files, only for urlStyle 'clean'", async () => {
    const runtime = await testRuntime();
    const site = await runtime.siteService.createBlankSite({ name: "Clean URL Site", slug: "clean-url-site" }, admin);
    // createBlankSite already defaults to urlStyle "clean" — confirm the .htaccess is written and
    // actually rewrites a non-root page (homepage "/" needs no rewrite — Apache's own
    // DirectoryIndex already resolves it to index.html).
    const revision1 = await runtime.revisionService.latest(site.id);
    const cleanResult = await buildSite({
      siteId: site.id,
      repoPath: site.repoPath,
      commitSha: revision1!.commitSha,
      buildsRoot: path.join(runtime.dataDir, "builds")
    });
    const htaccess = await fs.readFile(path.join(cleanResult.buildPath, ".htaccess"), "utf8");
    expect(htaccess).toContain("RewriteEngine On");
    expect(htaccess).toContain("RewriteRule ^(.*)$ $1.html [L]");

    await runtime.siteService.updateSettings(site, { urlStyle: "html-ext" }, admin);
    const revision2 = await runtime.revisionService.latest(site.id);
    const htExtResult = await buildSite({
      siteId: site.id,
      repoPath: site.repoPath,
      commitSha: revision2!.commitSha,
      buildsRoot: path.join(runtime.dataDir, "builds")
    });
    await expect(fs.access(path.join(htExtResult.buildPath, ".htaccess"))).rejects.toThrow();
  });

  it("doesn't flag a 'clean' urlStyle internal link as missing just because the file on disk still has .html", async () => {
    const runtime = await testRuntime();
    const site = await runtime.siteService.createBlankSite({ name: "Clean Link Site", slug: "clean-link-site" }, admin);
    await fs.writeFile(
      path.join(site.repoPath, "index.html"),
      '<html><body><a href="/about">About</a></body></html>',
      "utf8"
    );
    await fs.writeFile(path.join(site.repoPath, "about.html"), "<html><body>About</body></html>", "utf8");
    const revision = await runtime.revisionService.commitRevision({ site, source: "code-editor", title: "Clean-style link" });
    const result = await buildSite({
      siteId: site.id,
      repoPath: site.repoPath,
      commitSha: revision.commitSha,
      buildsRoot: path.join(runtime.dataDir, "builds")
    });
    expect(result.issues.some((issue) => issue.code === "MISSING_ASSET_OR_LINK")).toBe(false);

    // Same link, but html-ext style, where "/about" really is missing (the real file is
    // about.html) — the fallback must stay scoped to "clean" and not mask a genuine broken link.
    await runtime.siteService.updateSettings(site, { urlStyle: "html-ext" }, admin);
    const revision2 = await runtime.revisionService.latest(site.id);
    const result2 = await buildSite({
      siteId: site.id,
      repoPath: site.repoPath,
      commitSha: revision2!.commitSha,
      buildsRoot: path.join(runtime.dataDir, "builds")
    });
    expect(result2.issues.some((issue) => issue.code === "MISSING_ASSET_OR_LINK")).toBe(true);
  });
});

async function testRuntime() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "igle-build-test-"));
  const stateStore = new JsonStateStore(dataDir);
  const revisionService = new RevisionService(stateStore);
  const scriptService = new ScriptService(revisionService);
  return {
    dataDir,
    stateStore,
    revisionService,
    siteService: new SiteService(dataDir, stateStore, revisionService, scriptService),
    importService: new ImportService(stateStore, revisionService),
    seoService: new SEOService(stateStore, revisionService)
  };
}
