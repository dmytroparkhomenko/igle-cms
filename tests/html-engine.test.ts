import { describe, expect, it } from "vitest";
import { applyPageSEO, parsePageSEO } from "@igle/html-engine";

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
});
