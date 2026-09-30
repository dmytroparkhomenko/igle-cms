import { describe, expect, it } from "vitest";
import {
  affiliateClickScript,
  applyPageSEO,
  applyStructuralPatches,
  findTaggedCtaLinks,
  findUnmarkedExternalLinks,
  parsePageSEO,
  renameCtaAttribute,
  replaceImageSrcEverywhere,
  tagAffiliateCtas
} from "@igle/html-engine";
import { IgleError } from "@igle/shared";

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

  it("inserts a new favicon link when the page has none yet", () => {
    const html = "<html><head><title>A</title></head><body></body></html>";
    const result = applyPageSEO(html, { favicon: "/media/new-icon.png" });
    expect(result.html).toContain('<link rel="icon" href="/media/new-icon.png">');
  });

  it("updates an existing favicon link in place", () => {
    const html = '<html><head><link rel="icon" href="/old-icon.png"></head><body></body></html>';
    const result = applyPageSEO(html, { favicon: "/media/new-icon.png" });
    expect(result.html).toContain('href="/media/new-icon.png"');
    expect(result.html).not.toContain("/old-icon.png");
  });

  it("updates every icon link instead of throwing when a page has more than one (regression: this silently skipped the whole page before)", () => {
    const html =
      '<html><head>' +
      '<link rel="icon" href="/old-16.png" sizes="16x16">' +
      '<link rel="shortcut icon" href="/old-32.png" sizes="32x32">' +
      "</head><body></body></html>";
    const result = applyPageSEO(html, { favicon: "/media/new-icon.png" });
    expect(result.html).not.toContain("/old-16.png");
    expect(result.html).not.toContain("/old-32.png");
    expect(result.html.match(/href="\/media\/new-icon\.png"/g)).toHaveLength(2);
    expect(result.patches).toHaveLength(2);
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

describe("affiliate CTA tagging", () => {
  it("tags a dead-href anchor and backfills target/rel", () => {
    const html = '<a href="#" class="btn-gold">Get bonus</a>';
    const result = tagAffiliateCtas(html);
    expect(result.count).toBe(1);
    expect(result.html).toContain('data-igle-cta="default"');
    expect(result.html).toContain('target="_blank"');
    expect(result.html).toContain('rel="sponsored nofollow noopener noreferrer"');
  });

  it("does not tag a real in-page anchor like href=\"#main\"", () => {
    const html = '<a href="#main">Skip to content</a>';
    const result = tagAffiliateCtas(html);
    expect(result.count).toBe(0);
    expect(result.html).toBe(html);
  });

  it("tags an anchor carrying an existing aff-link class, neutralizing its real href", () => {
    const html = '<a href="https://real-offer.example/?pid=1" class="btn-x nnn-aff-link">Pegar bônus</a>';
    const result = tagAffiliateCtas(html);
    expect(result.count).toBe(1);
    expect(result.html).toContain('data-igle-cta="default"');
    expect(result.html).toContain('href="#"');
    expect(result.html).not.toContain("real-offer.example");
  });

  it("tags a real hardcoded href marked rel=\"sponsored\" (the dominant real-world case) and neutralizes it", () => {
    const html = '<a href="https://www.gbg00.vip/?pid=20001" class="btn btn-cta" target="_blank" rel="sponsored nofollow noopener noreferrer">JUGAR AHORA</a>';
    const result = tagAffiliateCtas(html);
    expect(result.count).toBe(1);
    expect(result.html).toContain('data-igle-cta="default"');
    expect(result.html).toContain('href="#"');
    expect(result.html).not.toContain("gbg00.vip");
    // target/rel were already present and correct — left untouched, not duplicated.
    expect(result.html).toContain('target="_blank"');
    expect((result.html.match(/rel="/g) ?? []).length).toBe(1);
  });

  it("does not tag a real external link with no sponsored/CTA signal at all (e.g. a responsible-gambling resource link)", () => {
    const html = '<a href="https://www.gamblingtherapy.org/" target="_blank" rel="noopener noreferrer">Get help</a>';
    const result = tagAffiliateCtas(html);
    expect(result.count).toBe(0);
    expect(result.html).toBe(html);
  });

  it("carries an existing data-dynamic-link value over as the slot", () => {
    const html = '<a href="#" data-dynamic-link="topBlock.ranked">Ver sitio</a>';
    const result = tagAffiliateCtas(html);
    expect(result.html).toContain('data-igle-cta="topBlock.ranked"');
  });

  it("is idempotent — skips an anchor already tagged", () => {
    const html = '<a href="#" data-igle-cta="default">Get bonus</a>';
    const result = tagAffiliateCtas(html);
    expect(result.count).toBe(0);
    expect(result.html).toBe(html);
  });

  it("does not preserve target/rel it doesn't already need to add", () => {
    const html = '<a href="#" target="_self" rel="noopener">Get bonus</a>';
    const result = tagAffiliateCtas(html);
    expect(result.html).toContain('target="_self"');
    expect(result.html).toContain('rel="noopener"');
    expect(result.html).not.toContain("sponsored nofollow");
  });
});

describe("unmarked external link audit", () => {
  it("flags a real hardcoded external tracking link", () => {
    const html = '<a href="https://www.taco3.vip/?pid=2059">JUGAR AHORA</a>';
    const results = findUnmarkedExternalLinks(html);
    expect(results).toHaveLength(1);
    expect(results[0]!.href).toBe("https://www.taco3.vip/?pid=2059");
  });

  it("excludes a known-safe host (fonts) and an already-tagged CTA", () => {
    const html =
      '<link href="https://fonts.googleapis.com/css2">' +
      '<a href="https://fonts.googleapis.com/foo">Font link</a>' +
      '<a href="https://real-offer.example/?ref=1" data-igle-cta="default">Already tagged</a>';
    expect(findUnmarkedExternalLinks(html)).toHaveLength(0);
  });

  it("leaves relative/root-relative links alone", () => {
    const html = '<a href="/casino">Casino</a><a href="./assets/x.css">asset</a>';
    expect(findUnmarkedExternalLinks(html)).toHaveLength(0);
  });
});

describe("applyStructuralPatches", () => {
  it("preserves both properties when two setStyle patches for the same element are applied together", () => {
    // Regression test: each patch used to be computed from the untouched original style attribute,
    // so two overwrites of the exact same attribute range meant whichever was processed last won
    // and silently discarded the other — saving a text color change together with a background
    // color change on the same element used to lose the text color entirely.
    // parse5 always synthesizes a full document around a fragment: html(0) > head(1) > body(2) > div(3).
    const html = '<div id="node">Hi</div>';
    const result = applyStructuralPatches(html, [
      { nodeId: 3, op: "setStyle", styleProperty: "color", value: "#ff0000" },
      { nodeId: 3, op: "setStyle", styleProperty: "background-color", value: "#00ff00" }
    ]);
    expect(result.html).toContain("color: #ff0000");
    expect(result.html).toContain("background-color: #00ff00");
  });

  it("creates a hover stylesheet and assigns a generated id when the element has none", () => {
    const html = "<html><head></head><body><button>Buy</button></body></html>";
    const result = applyStructuralPatches(html, [{ nodeId: 3, op: "setHoverStyle", styleProperty: "background-color", value: "#111111" }]);
    expect(result.html).toMatch(/id="igle-el-3"/);
    expect(result.html).toContain('data-igle-hover-styles="1"');
    expect(result.html).toContain("#igle-el-3:hover { background-color: #111111 !important }");
  });

  it("reuses an existing id instead of generating one", () => {
    const html = '<html><head></head><body><button id="hero-cta">Buy</button></body></html>';
    const result = applyStructuralPatches(html, [{ nodeId: 3, op: "setHoverStyle", styleProperty: "color", value: "#fff" }]);
    expect(result.html).not.toContain("igle-el-3");
    expect(result.html).toContain("#hero-cta:hover { color: #fff !important }");
  });

  it("merges multiple hover properties for the same element into one rule across the batch", () => {
    const html = '<html><head></head><body><button id="hero-cta">Buy</button></body></html>';
    const result = applyStructuralPatches(html, [
      { nodeId: 3, op: "setHoverStyle", styleProperty: "background-color", value: "#111" },
      { nodeId: 3, op: "setHoverStyle", styleProperty: "color", value: "#fff" }
    ]);
    const ruleMatch = /#hero-cta:hover \{([^}]*)\}/.exec(result.html);
    expect(ruleMatch).not.toBeNull();
    expect(ruleMatch![1]).toContain("background-color: #111");
    expect(ruleMatch![1]).toContain("color: #fff");
    // Only one <style data-igle-hover-styles> tag, not one per patch.
    expect(result.html.match(/data-igle-hover-styles/g)).toHaveLength(1);
  });

  it("updates an existing hover stylesheet in place on a later call instead of adding a second one", () => {
    const first = applyStructuralPatches('<html><head></head><body><button id="hero-cta">Buy</button></body></html>', [
      { nodeId: 3, op: "setHoverStyle", styleProperty: "color", value: "#fff" }
    ]);
    const second = applyStructuralPatches(first.html, [{ nodeId: 3, op: "setHoverStyle", styleProperty: "background-color", value: "#111" }]);
    expect(second.html.match(/data-igle-hover-styles/g)).toHaveLength(1);
    const ruleMatch = /#hero-cta:hover \{([^}]*)\}/.exec(second.html);
    expect(ruleMatch![1]).toContain("color: #fff");
    expect(ruleMatch![1]).toContain("background-color: #111");
  });

  // html(0) > head(1) > body(2) > section#a(3), section#b(4), section#c(5) — verified against parse5's actual numbering.
  const THREE_SECTIONS = '<html><head></head><body><section id="a">A</section><section id="b">B</section><section id="c">C</section></body></html>';

  it("moveDown swaps an element with its next sibling", () => {
    const result = applyStructuralPatches(THREE_SECTIONS, [{ nodeId: 3, op: "moveDown" }]);
    expect(result.html.indexOf('id="b"')).toBeLessThan(result.html.indexOf('id="a"'));
    expect(result.html).toContain('<section id="c">C</section>');
  });

  it("moveUp swaps an element with its previous sibling", () => {
    const result = applyStructuralPatches(THREE_SECTIONS, [{ nodeId: 4, op: "moveUp" }]);
    expect(result.html.indexOf('id="b"')).toBeLessThan(result.html.indexOf('id="a"'));
  });

  it("moveUp on the first element is a no-op", () => {
    const result = applyStructuralPatches(THREE_SECTIONS, [{ nodeId: 3, op: "moveUp" }]);
    expect(result.html).toBe(THREE_SECTIONS);
  });

  it("moveDown on the last element is a no-op", () => {
    const result = applyStructuralPatches(THREE_SECTIONS, [{ nodeId: 5, op: "moveDown" }]);
    expect(result.html).toBe(THREE_SECTIONS);
  });

  it("skips whitespace text nodes when finding the sibling to swap with, and leaves that whitespace untouched", () => {
    const html = '<html><head></head><body>\n  <section id="a">A</section>\n  <section id="b">B</section>\n</body></html>';
    const result = applyStructuralPatches(html, [{ nodeId: 3, op: "moveDown" }]);
    expect(result.html).toBe('<html><head></head><body>\n  <section id="b">B</section>\n  <section id="a">A</section>\n</body></html>');
  });

  // html(0) > head(1) > body(2) > div(3) > img(4), a(5) — verified against parse5's actual numbering.
  const DIV_WITH_IMG_AND_LINK =
    '<html><head></head><body><div><img src="x.png"></div><a href="https://real.example/x">Real link</a></body></html>';

  it("wrapInAnchor wraps a non-<a> element in a new marked, neutralized <a>", () => {
    const result = applyStructuralPatches(DIV_WITH_IMG_AND_LINK, [{ nodeId: 3, op: "wrapInAnchor" }]);
    expect(result.html).toContain('<a data-igle-cta="default" href="#" target="_blank" rel="sponsored nofollow noopener noreferrer"><div><img src="x.png"></div></a>');
  });

  it("unwrapAnchor reverses a wrapInAnchor round-trip, restoring the original markup", () => {
    // Wrapping inserts a new ancestor before the div in document order, so a *later, separate*
    // call re-numbers everything from there on — the wrapper itself becomes nodeId 3 and the div
    // (unchanged otherwise) becomes nodeId 4. Verified against parse5's actual output; this is the
    // same "insertion shifts node-order ids" effect already handled for the hover <style> tag.
    const wrapped = applyStructuralPatches(DIV_WITH_IMG_AND_LINK, [{ nodeId: 3, op: "wrapInAnchor" }]).html;
    const unwrapped = applyStructuralPatches(wrapped, [{ nodeId: 4, op: "unwrapAnchor" }]);
    expect(unwrapped.html).toBe(DIV_WITH_IMG_AND_LINK);
  });

  it("unwrapAnchor refuses to touch an element whose parent isn't a matching cta wrapper", () => {
    // nodeId 5 is the real <a>, a sibling of the div — not wrapped by anything.
    expect(() => applyStructuralPatches(DIV_WITH_IMG_AND_LINK, [{ nodeId: 5, op: "unwrapAnchor" }])).toThrow(IgleError);
  });
});

describe("findTaggedCtaLinks", () => {
  it("lists every element carrying data-igle-cta, tagged or wrapped", () => {
    const html =
      '<a data-igle-cta="default" href="#">Join now</a>' +
      '<a data-igle-cta="default" href="#"><div><img src="x.png" alt="Bonus"></div></a>' +
      '<a href="/about">About</a>';
    const results = findTaggedCtaLinks(html);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ tagName: "a", slot: "default", text: "Join now", href: "#" });
    expect(results[1]).toMatchObject({ tagName: "a", slot: "default", href: "#" });
  });

  it("returns an empty list when nothing is tagged", () => {
    expect(findTaggedCtaLinks('<a href="/about">About</a>')).toHaveLength(0);
  });
});

describe("renameCtaAttribute", () => {
  it("renames data-igle-cta to the given attribute, preserving its value", () => {
    const html = '<a data-igle-cta="default" href="#">Buy</a>';
    const result = renameCtaAttribute(html, "data-igle-cta", "data-go");
    expect(result.count).toBe(1);
    expect(result.html).toContain('data-go="default"');
    expect(result.html).not.toContain("data-igle-cta");
  });

  it("is a no-op when nothing carries the attribute", () => {
    const html = "<a href=\"#\">Buy</a>";
    const result = renameCtaAttribute(html, "data-igle-cta", "data-go");
    expect(result.count).toBe(0);
    expect(result.html).toBe(html);
  });
});

describe("affiliateClickScript", () => {
  it("bakes the destination URL directly into the script, keyed off the given attribute", () => {
    const script = affiliateClickScript("https://real-offer.example/?pid=1", "data-go");
    expect(script).toContain('"[data-go]"');
    expect(script).toContain('"https://real-offer.example/?pid=1"');
    expect(script).not.toContain("/api/r/");
  });

  it("defaults to the CTA_SHIP_ATTR attribute name", () => {
    const script = affiliateClickScript("https://real-offer.example/?pid=1");
    expect(script).toContain('"[data-go]"');
  });
});
