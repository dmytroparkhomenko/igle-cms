import { describe, expect, it } from "vitest";
import { discoverPages, rewritePageReferences, rewriteReference } from "@igle/core";

describe("template asset reference rewriting", () => {
  it("rewrites a normal relative image reference to /assets/...", () => {
    const result = rewriteReference("images/hero.webp", "index.html", new Map());
    expect(result).toEqual({ value: "/assets/images/hero.webp", kind: "asset", assetOriginPath: "images/hero.webp" });
  });

  it("leaves external and special links untouched", () => {
    expect(rewriteReference("https://example.com/x.png", "index.html", new Map()).kind).toBe("external");
    expect(rewriteReference("mailto:a@b.com", "index.html", new Map()).kind).toBe("external");
    expect(rewriteReference("#section", "index.html", new Map()).kind).toBe("external");
  });

  it("points an internal link at the matching page's route", () => {
    const pages = discoverPages(["index.html", "bono/index.html"]);
    const byKey = new Map(pages.map((page) => [page.matchKey, page]));
    expect(rewriteReference("bono/index.html", "index.html", byKey)).toEqual({ value: "/bono", kind: "page" });
  });

  it("corrects a redundant leading assets/ segment when the literal path doesn't exist but the stripped one does", () => {
    // Reproduces a real uploaded template: <img src="assets/images/hero_banner_casinomx.webp">
    // where the file actually sits at "images/hero_banner_casinomx.webp" in the zip — naively
    // rewriting produced "/assets/assets/images/...", which nothing was ever copied to.
    const realAssetPaths = new Set(["images/hero_banner_casinomx.webp"]);
    const result = rewriteReference("assets/images/hero_banner_casinomx.webp", "index.html", new Map(), realAssetPaths);
    expect(result.value).toBe("/assets/images/hero_banner_casinomx.webp");
  });

  it("leaves a genuine assets/assets/ nesting alone when that's actually where the file is", () => {
    const realAssetPaths = new Set(["assets/images/nested.webp"]);
    const result = rewriteReference("assets/images/nested.webp", "index.html", new Map(), realAssetPaths);
    expect(result.value).toBe("/assets/assets/images/nested.webp");
  });

  it("rewrites href/src attributes but leaves srcset alone when using the legacy 3-arg call", () => {
    const html = '<img src="images/a.webp" srcset="images/a.webp 1x, images/a-2x.webp 2x">';
    const out = rewritePageReferences(html, "index.html", new Map(), new Set());
    expect(out).toContain('src="/assets/images/a.webp"');
    expect(out).toContain('srcset="/assets/images/a.webp 1x, /assets/images/a-2x.webp 2x"');
  });

  it("rewrites a single-entry srcset with no descriptor, as found in a real <picture> element", () => {
    const html = '<source media="(max-width: 767px)" srcset="assets/images/promo_mobile.webp" width="767" height="304">';
    const realAssetPaths = new Set(["images/promo_mobile.webp"]);
    const out = rewritePageReferences(html, "index.html", new Map(), new Set(), realAssetPaths);
    expect(out).toContain('srcset="/assets/images/promo_mobile.webp"');
  });

  it("rewrites every entry of a multi-source srcset independently", () => {
    const html = '<img srcset="images/a.webp 640w, images/b.webp 1280w">';
    const out = rewritePageReferences(html, "index.html", new Map(), new Set());
    expect(out).toBe('<img srcset="/assets/images/a.webp 640w, /assets/images/b.webp 1280w">');
  });
});
