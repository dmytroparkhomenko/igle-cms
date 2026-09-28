import { describe, expect, it } from "vitest";
import { applyPageSEO, parsePageSEO, replaceImageSrcEverywhere } from "@igle/html-engine";

describe("HTML engine", () => {
  it("extracts SEO fields and page counts", () => {
    const parsed = parsePageSEO(`<!doctype html><html lang="en"><head><title>A</title><meta name="description" content="B"></head><body><h1>C</h1><img src="x.png"></body></html>`);
    expect(parsed.lang).toBe("en");
    expect(parsed.seoTitle.value).toBe("A");
    expect(parsed.metaDescription.value).toBe("B");
    expect(parsed.h1.value).toBe("C");
    expect(parsed.imagesMissingAlt).toBe(1);
  });

  it("flags duplicate title as ambiguous", () => {
    const parsed = parsePageSEO("<html><head><title>A</title><title>B</title></head><body><h1>C</h1></body></html>");
    expect(parsed.seoTitle.state).toBe("ambiguous");
    expect(parsed.issues.some((issue) => issue.code === "DUPLICATE_TITLE")).toBe(true);
  });

  it("patches only field ranges instead of reserializing the document", () => {
    const html = "<!doctype html><html><head><title>Old</title><meta name=\"description\" content=\"Old description\"></head><body><h1>Old H1</h1><p>Keep me.</p></body></html>";
    const result = applyPageSEO(html, {
      seoTitle: "New",
      metaDescription: "New description",
      h1: "New H1"
    });
    expect(result.html).toContain("<title>New</title>");
    expect(result.html).toContain("content=\"New description\"");
    expect(result.html).toContain("<h1>New H1</h1>");
    expect(result.html).toContain("<p>Keep me.</p>");
    expect(result.patches).toHaveLength(3);
  });

  it("replaces a plain <img src> and strips its (now stale) srcset", () => {
    const html = '<img src="/site/assets/a.webp" srcset="/site/assets/a.webp 1x, /site/assets/a-2x.webp 2x">';
    const result = replaceImageSrcEverywhere(html, "/site/assets/a.webp", "/site/media/new.webp");
    expect(result.html).toBe('<img src="/site/media/new.webp">');
    expect(result.count).toBe(1);
  });

  it("rewrites a sibling <source>'s srcset when its URL exactly matches the swapped img's old src", () => {
    const html = '<picture><source media="(max-width: 767px)" srcset="/site/assets/a.webp"><img src="/site/assets/a.webp"></picture>';
    const result = replaceImageSrcEverywhere(html, "/site/assets/a.webp", "/site/media/new.webp");
    expect(result.html).toContain('srcset="/site/media/new.webp"');
    expect(result.html).toContain('src="/site/media/new.webp"');
  });

  it("drops a <picture>'s <source> elements when swapping its <img> and the srcset doesn't textually match", () => {
    // Reproduces a real reported bug: the page's <img src> was an absolute "/slug/assets/..." path
    // while its sibling <source srcset> values were still relative "assets/..." — an exact-string
    // match can never succeed, so the sources kept pointing at the old images. Since a <source>
    // always wins over the <img> fallback whenever its media query matches, and here the two media
    // queries cover every possible viewport width between them, the "replaced" image was never
    // actually visible at any screen size even though the <img src> itself was correct and live.
    const html =
      '<picture class="hero-bg-picture">' +
      '<source media="(max-width: 767px)" srcset="assets/images/hero_banner_casinomx_mobile.webp" width="767" height="296">' +
      '<source media="(min-width: 768px)" srcset="assets/images/hero_banner_casinomx.webp" width="1440" height="555">' +
      '<img src="/bet559br-bet/assets/images/hero_banner_casinomx.webp" alt="Play More, Win Bigger Rewards" class="hero-bg-img" width="1440" height="555">' +
      "</picture>";
    const result = replaceImageSrcEverywhere(html, "/bet559br-bet/assets/images/hero_banner_casinomx.webp", "/bet559br-bet/media/new-hero.webp");
    expect(result.html).not.toContain("<source");
    expect(result.html).toContain('src="/bet559br-bet/media/new-hero.webp"');
    // The alt/class/dimensions and everything outside the removed <source> tags survives untouched.
    expect(result.html).toContain('alt="Play More, Win Bigger Rewards"');
    expect(result.html).toContain('class="hero-bg-img"');
    expect(result.html).toContain("</picture>");
  });

  it("leaves a picture's other <source> elements alone when a different image on the page is swapped", () => {
    const html =
      '<picture><source media="(max-width: 767px)" srcset="assets/other.webp"><img src="/site/assets/unrelated.webp"></picture>' +
      '<img src="/site/assets/logo.webp">';
    const result = replaceImageSrcEverywhere(html, "/site/assets/logo.webp", "/site/media/new-logo.webp");
    expect(result.html).toContain('srcset="assets/other.webp"');
    expect(result.html).toContain('src="/site/media/new-logo.webp"');
    expect(result.html).toContain('src="/site/assets/unrelated.webp"');
  });
});
