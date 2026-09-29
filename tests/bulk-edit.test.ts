import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStateStore, RevisionService, SEOService, SiteService } from "@igle/core";
import type { Actor } from "@igle/shared";

const admin: Actor = { id: "admin", email: "admin@example.com", role: "administrator" };

describe("bulk content edit (SEOService.listEditableTextNodes + applyVisualEdits)", () => {
  it("edits only the changed fields, preserves inline markup and untouched fields, and stays fresh on re-list", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "igle-test-"));
    const stateStore = new JsonStateStore(dataDir);
    const revisionService = new RevisionService(stateStore);
    const siteService = new SiteService(dataDir, stateStore, revisionService);
    const seoService = new SEOService(stateStore, revisionService);

    const site = await siteService.createBlankSite({ name: "Bulk Edit Test", slug: "bulk-edit-test" }, admin);
    const state = await stateStore.read();
    const homePage = state.pages.find((page) => page.siteId === site.id && page.route === "/")!;

    const html =
      "<!doctype html><html><head><title>Home</title></head><body>\n" +
      "<h1>Welcome to Old Brand</h1>\n" +
      "<p>This is the <strong>first</strong> paragraph of old copy.</p>\n" +
      "<p>This is the second paragraph, also old.</p>\n" +
      '<a href="/contact">Contact us</a>\n' +
      "</body></html>";
    await fs.writeFile(path.join(site.repoPath, homePage.filePath), html, "utf8");

    const nodes = await seoService.listEditableTextNodes(site, homePage.id, admin);
    expect(nodes.map((node) => node.tagName)).toEqual(["h1", "p", "p", "a"]);
    const [h1, para1, para2, link] = nodes;
    expect(para1!.html).toBe("This is the <strong>first</strong> paragraph of old copy.");

    const result = await seoService.applyVisualEdits(
      site,
      homePage.id,
      [
        { nodeId: h1!.nodeId, op: "setInnerHtml", value: "Welcome to New Brand" },
        { nodeId: para1!.nodeId, op: "setInnerHtml", value: "This is the <strong>first</strong> paragraph of NEW copy." }
        // para2 and link deliberately left out — an untouched field in a real bulk-edit submit.
      ],
      admin
    );
    expect(result.revisionNumber).toBe(2);

    const after = await fs.readFile(path.join(site.repoPath, homePage.filePath), "utf8");
    expect(after).toContain("<h1>Welcome to New Brand</h1>");
    expect(after).toContain("This is the <strong>first</strong> paragraph of NEW copy.");
    // Untouched fields survive byte-for-byte, including the second paragraph's own <strong>-free text.
    expect(after).toContain("<p>This is the second paragraph, also old.</p>");
    expect(after).toContain('<a href="/contact">Contact us</a>');
    void link;

    // Re-listing (as a second bulk-edit page load, or the visual editor's own iframe, would) picks
    // up the save immediately — no caching/staleness between the two tools.
    const nodesAfter = await seoService.listEditableTextNodes(site, homePage.id, admin);
    expect(nodesAfter.map((node) => node.preview)).toEqual([
      "Welcome to New Brand",
      "This is the first paragraph of NEW copy.",
      "This is the second paragraph, also old.",
      "Contact us"
    ]);
  });
});
