import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Actor } from "@igle/shared";

const admin: Actor = { id: "admin", email: "admin@example.com", role: "administrator" };

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  console.log("smoke: creating runtime");
  console.log("smoke: loading @igle/build");
  const { scanFootprint } = await import("@igle/build");
  console.log("smoke: loading state store");
  const { JsonStateStore } = await import("../packages/core/src/state-store.ts");
  console.log("smoke: loading revision service");
  const { RevisionService } = await import("../packages/core/src/revision-service.ts");
  console.log("smoke: loading site service");
  const { SiteService } = await import("../packages/core/src/site-service.ts");
  console.log("smoke: loading import service");
  const { ImportService } = await import("../packages/core/src/import-service.ts");
  console.log("smoke: loading SEO service");
  const { SEOService } = await import("../packages/core/src/seo-service.ts");
  console.log("smoke: loading @igle/shared");
  const { can } = await import("@igle/shared");
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "igle-smoke-"));
  const stateStore = new JsonStateStore(dataDir);
  const revisionService = new RevisionService(stateStore);
  const siteService = new SiteService(dataDir, stateStore, revisionService);
  const importService = new ImportService(stateStore, revisionService);
  const seoService = new SEOService(stateStore, revisionService);

  console.log("smoke: creating blank site");
  const site = await siteService.createBlankSite({ name: "Smoke Site", slug: "smoke" }, admin);
  assert.equal((await revisionService.list(site.id)).length, 1);
  assert.equal((await revisionService.integrity(site)).ok, true);

  console.log("smoke: importing fixture");
  const imported = await importService.importDirectory(site, path.resolve("fixtures/site-basic"), admin);
  assert.equal(imported.revisionNumber, 2);
  assert.equal(imported.report.pagesFound, 2);

  const state = await stateStore.read();
  const page = state.pages.find((item) => item.siteId === site.id && item.filePath === "index.html");
  assert.ok(page);
  assert.equal(page.seoTitle, "Original Home Title");

  console.log("smoke: editing SEO field");
  const edited = await seoService.updateFields(site, page.id, { seoTitle: "Smoke Updated Title" }, admin);
  assert.equal(edited.revisionNumber, 3);

  console.log("smoke: comparing revisions");
  const diff = await revisionService.compare(site, 2, 3);
  assert.match(diff, /Original Home Title/);
  assert.match(diff, /Smoke Updated Title/);

  console.log("smoke: restoring revision");
  const restored = await revisionService.restore(site, 2, { id: admin.id, name: admin.email, email: admin.email });
  assert.equal(restored.revisionNumber, 4);
  assert.equal((await revisionService.integrity(site)).ok, true);

  console.log("smoke: scanning footprint and permissions");
  assert.equal(can({ id: "editor", email: "editor@example.com", role: "editor", siteGrants: [] }, "sites.read", site.id), false);
  assert.deepEqual(await scanFootprint(site.repoPath), []);

  console.log(
    JSON.stringify(
      {
        ok: true,
        dataDir,
        siteId: site.id,
        revisions: (await revisionService.list(site.id)).map((revision) => ({
          number: revision.revisionNumber,
          source: revision.source,
          commitSha: revision.commitSha.slice(0, 12)
        }))
      },
      null,
      2
    )
  );
}
