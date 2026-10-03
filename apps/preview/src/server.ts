import fs from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import { AffiliateLinkService, JsonStateStore, type SiteRecord } from "@igle/core";
import { affiliateClickScript, annotateNodesForEditing, neutralizeScripts } from "@igle/html-engine";
import { IgleError, resolveInside } from "@igle/shared";

const dataDir = process.env.IGLE_DATA_DIR ?? path.resolve(process.cwd(), "data");
const stateStore = new JsonStateStore(dataDir);
const affiliateLinkService = new AffiliateLinkService(stateStore);
const app = Fastify({ logger: true });

/**
 * Set when this service is only reachable through a reverse proxy's path prefix rather than its
 * own directly-exposed port (e.g. "/preview" when Caddy's `handle_path /preview/*` is the only
 * public way in — see docker/caddy/Caddyfile) — empty by default, matching local dev, where the
 * preview service is hit directly on its own port with no prefix at all.
 *
 * Route *matching* here never needs to know about this: `handle_path` strips the prefix before
 * forwarding, so an incoming request already looks exactly like a direct, unprefixed one by the
 * time it reaches this server (confirmed: `/preview/__igle/bridge.js` through Caddy correctly
 * reaches the plain `/__igle/bridge.js` route below with zero changes). What *does* need to know
 * about it is anything this server writes into a response that the browser will later resolve as
 * an absolute path — those need the prefix baked back in, or the browser's follow-up request for
 * them skips the proxy's path match entirely and 404s at the root. Confirmed the real cause of
 * "double-click to edit doesn't work" and "Edit as HTML doesn't apply" in exactly this kind of
 * deployment: the injected bridge script's own `<script src="/__igle/bridge.js">` resolved to the
 * domain root, missing the "/preview" prefix, so the browser's own request for the actual bridge
 * script never reached this server at all — nothing was there to relay postMessage events between
 * the parent editor and the iframe.
 */
const basePath = (process.env.PREVIEW_BASE_PATH ?? "").replace(/\/+$/, "");

/**
 * Same click-redirect script a real deploy bakes in (see @igle/build's bakeAffiliateLinks) —
 * injected here too so marking an element as an affiliate link is actually checkable in the
 * preview, not just after a full deploy. Resolves the destination the same way a deploy does
 * (AffiliateLinkService.resolveForSite) but keyed off `data-igle-cta`, not the shipped `data-go`
 * attribute — a real build renames it, but preview always serves the page's own un-renamed
 * source, so the injected script has to match the name actually present here. Skipped entirely
 * when nothing's configured (no override, no GEO match for the site's country) — nothing to send
 * a click to. In edit mode this never actually fires: the bridge script's own document-level click
 * listener runs first (capture phase) and calls stopPropagation(), so this delegated bubble-phase
 * listener never sees the event — injecting it unconditionally is simplest and harmless rather
 * than threading an edit-mode exception through.
 */
async function injectAffiliateCloak(html: string, site: SiteRecord): Promise<string> {
  const destination = await affiliateLinkService.resolveForSite(site);
  if (!destination) return html;
  const script = affiliateClickScript(destination, "data-igle-cta");
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`) : `${html}${script}`;
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".pdf": "application/pdf"
};

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof IgleError) {
    return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "File was not found." } });
  }
  app.log.error(error);
  return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Unexpected preview error." } });
});

app.addHook("onSend", async (_request, reply) => {
  reply.header("X-Robots-Tag", "noindex, nofollow");
});

app.get("/health", async () => ({ ok: true }));

app.get("/__igle/bridge.js", async (_request, reply) => {
  reply.header("Cache-Control", "no-store");
  reply.header("Content-Type", "text/javascript; charset=utf-8");
  return reply.send(BRIDGE_SCRIPT);
});

app.get("/:siteId/*", async (request, reply) => {
  const params = request.params as { siteId: string; "*": string };
  const query = request.query as { igle_edit?: string };
  const editMode = query.igle_edit === "1";

  const state = await stateStore.read();
  const site = state.sites.find((item) => item.id === params.siteId || item.slug === params.siteId);
  if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

  const requested = params["*"] ?? "";
  if (requested === ".igle" || requested.startsWith(".igle/")) throw new IgleError("NOT_FOUND", "File was not found.", 404);

  if (requested === "robots.txt") {
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Type", "text/plain; charset=utf-8");
    return reply.send("User-agent: *\nDisallow: /\n");
  }

  const requestRoute = requested === "" ? "/" : `/${requested.replace(/\/+$/, "")}`;
  const page = state.pages.find(
    (item) => item.siteId === site.id && normalizeRoute(item.route) === normalizeRoute(requestRoute)
  );
  const filePath = page ? page.filePath : requested === "" || requested.endsWith("/") ? `${requested}index.html` : requested;

  const absolutePath = resolveInside(site.repoPath, filePath);
  const content = await fs.readFile(absolutePath);
  const contentType = contentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  reply.header("Cache-Control", "no-store");
  reply.header("Content-Type", contentType);

  if (contentType.startsWith("text/html")) {
    let html = rewriteAbsolutePaths(content.toString("utf8"), params.siteId);
    html = await injectAffiliateCloak(html, site);
    if (editMode) {
      html = neutralizeScripts(html);
      html = annotateNodesForEditing(html);
      html = injectBridge(html);
    }
    return reply.send(html);
  }
  return reply.send(content);
});

function injectBridge(html: string): string {
  const tag = `<script src="${basePath}/__igle/bridge.js"></script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}</body>`);
  return `${html}${tag}`;
}

function normalizeRoute(route: string): string {
  if (route === "/") return "/";
  return route.replace(/\/+$/, "");
}

/**
 * Site HTML commonly hard-codes root-relative paths (src="/assets/x.png"). The preview
 * origin serves every site under a /<siteId>/ prefix, so those resolve to the wrong URL
 * in the browser. This rewrites only the served bytes — the file on disk is untouched.
 *
 * `srcset` needs its own pass: it's a comma-separated list of "url descriptor" candidates (e.g.
 * `<picture><source srcset="...">`), not a single URL like src/href, so each candidate's URL is
 * rewritten individually rather than treating the whole attribute value as one path.
 */
function rewriteAbsolutePaths(html: string, siteId: string): string {
  const prefix = `${basePath}/${siteId}`;
  const withSrcAndHref = html.replace(/(\s(?:src|href)=")\/(?!\/)([^"]*)(")/gi, `$1${prefix}/$2$3`);
  return withSrcAndHref.replace(/(\ssrcset=")([^"]*)(")/gi, (_match, open: string, value: string, close: string) => {
    const rewritten = value
      .split(",")
      .map((candidate) => {
        const trimmed = candidate.trim();
        if (!trimmed) return trimmed;
        const spaceIndex = trimmed.search(/\s/);
        const url = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
        const descriptor = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex);
        if (!url.startsWith("/") || url.startsWith("//")) return trimmed;
        return `${prefix}${url}${descriptor}`;
      })
      .join(", ");
    return `${open}${rewritten}${close}`;
  });
}

const BRIDGE_SCRIPT = `(function () {
  "use strict";
  var currentOutline = null;
  var BASE_PATH = ${JSON.stringify(basePath)};

  function target(el) {
    return el && el.closest ? el.closest("[data-igle-node]") : null;
  }

  // True when el's own parent is exactly the <a data-igle-cta> wrapper the "Mark as affiliate
  // link" toggle creates for a non-<a> element (see wrapInAnchor/unwrapAnchor) — checked
  // structurally (parent is an <a> carrying data-igle-cta, with el as its only element child)
  // rather than by any session-local bookkeeping, so it reads correctly both for a wrap made this
  // session and one that was saved and reloaded from disk.
  function wrappingCtaAnchor(el) {
    var parent = el.parentElement;
    if (!parent || parent.tagName !== "A" || !parent.hasAttribute("data-igle-cta")) return null;
    var elementChildren = parent.children;
    if (elementChildren.length !== 1 || elementChildren[0] !== el) return null;
    return parent;
  }

  // Every element carries its own data-igle-node marker in edit mode (see
  // annotateNodesForEditing), not just whichever one is selected — so a plain el.innerHTML read
  // includes that marker on any nested child elements too. Used wherever a chunk of innerHTML
  // is handed back to the parent editor (describe()'s "html" field, the double-click text-edit
  // commit below) so it never ends up captured in a setInnerHtml patch and written to the saved
  // file — belt-and-suspenders alongside the server's own stripping in sanitizeInlineHtml.
  function innerHtmlWithoutNodeMarkers(el) {
    var clone = el.cloneNode(true);
    var marked = clone.querySelectorAll("[data-igle-node]");
    for (var i = 0; i < marked.length; i++) marked[i].removeAttribute("data-igle-node");
    return clone.innerHTML;
  }

  // Same idea as innerHtmlWithoutNodeMarkers but captures the element's own outer HTML (including
  // its own data-igle-node, which this also strips) — used for the Elements panel's scanned
  // candidates, where the captured markup becomes an insertHtml patch's value and must be exactly
  // as clean as any other value that ends up written to the saved file.
  function outerHtmlWithoutNodeMarkers(el) {
    var clone = el.cloneNode(true);
    clone.removeAttribute("data-igle-node");
    var marked = clone.querySelectorAll("[data-igle-node]");
    for (var i = 0; i < marked.length; i++) marked[i].removeAttribute("data-igle-node");
    return clone.outerHTML;
  }

  function describe(el) {
    var ancestors = [];
    var current = el.parentElement ? el.parentElement.closest("[data-igle-node]") : null;
    while (current) {
      ancestors.push({ nodeId: Number(current.getAttribute("data-igle-node")), tagName: current.tagName.toLowerCase() });
      current = current.parentElement ? current.parentElement.closest("[data-igle-node]") : null;
    }
    var computed = window.getComputedStyle(el);
    var siblingElements = el.parentElement ? el.parentElement.children : [];
    var siblingIndex = Array.prototype.indexOf.call(siblingElements, el);
    return {
      nodeId: Number(el.getAttribute("data-igle-node")),
      tagName: el.tagName.toLowerCase(),
      html: innerHtmlWithoutNodeMarkers(el),
      text: el.textContent,
      src: el.getAttribute("src"),
      href: el.getAttribute("href"),
      alt: el.getAttribute("alt"),
      className: el.getAttribute("class") || "",
      color: rgbToHex(computed.color),
      backgroundColor: rgbToHex(computed.backgroundColor),
      borderColor: rgbToHex(computed.borderTopColor),
      borderWidth: computed.borderTopWidth,
      borderRadius: computed.borderTopLeftRadius,
      padding: computed.paddingTop,
      textAlign: computed.textAlign,
      letterSpacing: computed.letterSpacing,
      textTransform: computed.textTransform,
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      width: computed.width,
      height: computed.height,
      margin: computed.marginTop,
      display: computed.display,
      alignItems: computed.alignItems,
      justifyContent: computed.justifyContent,
      opacity: computed.opacity,
      filter: computed.filter,
      boxShadow: computed.boxShadow,
      dataIgleCta: el.getAttribute("data-igle-cta"),
      wrappedInCta: Boolean(wrappingCtaAnchor(el)),
      hasPrevSibling: siblingIndex > 0,
      hasNextSibling: siblingIndex !== -1 && siblingIndex < siblingElements.length - 1,
      ancestors: ancestors
    };
  }

  // Labels a tree row something more useful than the bare tag name: an id attr is the strongest
  // hint of "what is this", then the first class token, then a short peek at the element's own
  // direct text (not its descendants' — that would make every ancestor of a text node show the
  // same label as its innermost child). Empty string falls through to just the tag name alone in
  // the tree UI, which is never ambiguous since the tag is always shown as a prefix there.
  function elementLabel(el) {
    var idAttr = el.getAttribute("id");
    if (idAttr) return "#" + idAttr;
    var classAttr = el.getAttribute("class");
    if (classAttr) {
      var firstClass = classAttr.split(/\\s+/).filter(function (token) { return token; })[0];
      if (firstClass) return "." + firstClass;
    }
    var text = "";
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) text += el.childNodes[i].textContent;
    }
    text = text.replace(/\\s+/g, " ").replace(/^\\s+|\\s+$/g, "");
    return text.length > 30 ? text.slice(0, 30) + "\\u2026" : text;
  }

  // Full-page structure for the Layers panel — walks from document.body down, skipping <script>
  // and <style> (never visible/selectable in the canvas, so they'd just be dead rows; this also
  // quietly excludes the affiliate-cloak <script> injectAffiliateCloak adds before annotation runs,
  // which otherwise picks up a real data-igle-node id like any other element). Requested fresh by
  // the parent after every structural edit rather than diffed client-side, since node ids are only
  // valid for one snapshot of the document (see walkElementsWithId on the server).
  function buildTree(el) {
    var children = [];
    for (var i = 0; i < el.children.length; i++) {
      var child = el.children[i];
      if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
      children.push(buildTree(child));
    }
    return {
      nodeId: Number(el.getAttribute("data-igle-node")),
      tagName: el.tagName.toLowerCase(),
      label: elementLabel(el),
      children: children
    };
  }

  // True when 2+ of el's own element siblings (under the same parent) share both its tag name and
  // its full class string — a strong, template-agnostic signal that el is one instance of a
  // repeating card/list-item/pricing-tier, regardless of what that template happens to call its
  // classes. Returns a key scoped to this specific parent (via the parent's own data-igle-node, so
  // unrelated ".item" groups elsewhere in the page never collide) or null when el isn't part of
  // such a group at all (no class, or fewer than 2 matching siblings).
  function siblingGroupKey(el) {
    var parent = el.parentElement;
    if (!parent) return null;
    var cls = el.getAttribute("class");
    if (!cls) return null;
    var matches = 0;
    for (var i = 0; i < parent.children.length; i++) {
      var sibling = parent.children[i];
      if (sibling.tagName === el.tagName && sibling.getAttribute("class") === cls) matches++;
    }
    return matches >= 2 ? parent.getAttribute("data-igle-node") + "|" + el.tagName + "|" + cls : null;
  }

  // Tag-semantics-first on purpose — works the same on any uploaded template regardless of its own
  // class-naming convention, unlike a hardcoded ".btn-primary"-style lookup that would only match
  // templates happening to use that exact name. "Buttons & links" is deliberately a loose, honest
  // heuristic (any classed <a>, not just ones that look button-shaped) rather than a guarantee —
  // candidates carry their real tag+label so the Elements panel lets the user judge for themselves.
  function reusableCategory(el, repeatGroupKey) {
    if (/^H[1-6]$/.test(el.tagName)) return "Headings";
    if (el.tagName === "IMG") return "Images";
    if (el.tagName === "BUTTON" || (el.tagName === "A" && el.getAttribute("class"))) return "Buttons & links";
    if (repeatGroupKey) return "Repeating blocks";
    return null;
  }

  // Scans for elements worth offering as draggable building blocks in the Elements panel — see
  // reusableCategory/siblingGroupKey above for the classification rules. Only one representative
  // per repeating-block group is offered (dragging it in adds one more instance of the pattern,
  // which is the point); every other category offers every match, since e.g. two different
  // headings or buttons are rarely "the same thing" the way repeated cards are.
  function scanReusableElements() {
    var items = [];
    var seenRepeatGroups = {};
    function walk(el) {
      for (var i = 0; i < el.children.length; i++) {
        var child = el.children[i];
        if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
        var repeatGroupKey = siblingGroupKey(child);
        var category = reusableCategory(child, repeatGroupKey);
        if (category && !(category === "Repeating blocks" && seenRepeatGroups[repeatGroupKey])) {
          if (category === "Repeating blocks") seenRepeatGroups[repeatGroupKey] = true;
          items.push({
            nodeId: Number(child.getAttribute("data-igle-node")),
            tagName: child.tagName.toLowerCase(),
            label: elementLabel(child),
            category: category,
            html: outerHtmlWithoutNodeMarkers(child)
          });
        }
        walk(child);
      }
    }
    walk(document.body);
    return items;
  }

  // Every site is served under /<siteSlug>/ here (see rewriteAbsolutePaths on the server side,
  // which does the equivalent rewrite for HTML sent on a real page load). Derives the slug from
  // this frame's own URL rather than needing it passed in some other way — stripping BASE_PATH
  // first when this service is only reachable through a reverse-proxy path prefix, or the slug
  // segment would be read as whatever that prefix is instead (e.g. "preview") and this would
  // build a broken image URL instead of a real one.
  function withSitePrefix(value) {
    if (!value || value.charAt(0) !== "/" || value.charAt(1) === "/") return value;
    var pathname = window.location.pathname;
    if (BASE_PATH && pathname.indexOf(BASE_PATH) === 0) pathname = pathname.slice(BASE_PATH.length);
    var segments = pathname.split("/");
    var sitePrefix = segments.length > 1 && segments[1] ? "/" + segments[1] : "";
    return BASE_PATH + sitePrefix + value;
  }

  // Rewrites the URL of any srcset candidate exactly matching oldSrc, preserving each
  // candidate's width/pixel-density descriptor — same rule as the server-side rewrite.
  // Returns null (no-op) if nothing in the list matched.
  function rewriteSrcsetForOldSrc(srcsetValue, oldSrc, newSrc) {
    if (!srcsetValue) return null;
    var parts = srcsetValue.split(",");
    var changed = false;
    var result = [];
    for (var i = 0; i < parts.length; i++) {
      var candidate = parts[i].replace(/^\\s+|\\s+$/g, "");
      if (!candidate) continue;
      var spaceIndex = candidate.search(/\\s/);
      var url = spaceIndex === -1 ? candidate : candidate.slice(0, spaceIndex);
      var descriptor = spaceIndex === -1 ? "" : candidate.slice(spaceIndex);
      if (url === oldSrc) {
        changed = true;
        result.push(newSrc + descriptor);
      } else {
        result.push(candidate);
      }
    }
    return changed ? result.join(", ") : null;
  }

  // Same merge behavior as mergeStyleDeclaration on the server (@igle/html-engine) — sets one
  // property in a "prop: val; prop2: val2" declaration list, preserving every other property
  // already there, removing the property instead when value is blank.
  function mergeDeclarationText(current, property, value) {
    var declarations = {};
    var order = [];
    var parts = (current || "").split(";");
    for (var i = 0; i < parts.length; i++) {
      var colonIndex = parts[i].indexOf(":");
      if (colonIndex === -1) continue;
      var name = parts[i].slice(0, colonIndex).replace(/^\\s+|\\s+$/g, "").toLowerCase();
      var val = parts[i].slice(colonIndex + 1).replace(/^\\s+|\\s+$/g, "");
      if (!name) continue;
      if (!(name in declarations)) order.push(name);
      declarations[name] = val;
    }
    var key = property.trim().toLowerCase();
    if (value.trim() === "") {
      delete declarations[key];
      order = order.filter(function (name) { return name !== key; });
    } else {
      if (!(key in declarations)) order.push(key);
      declarations[key] = value.trim();
    }
    return order.map(function (name) { return name + ": " + declarations[name]; }).join("; ");
  }

  // Live-only preview of a :hover rule — never written to the page, just an ephemeral <style> tag
  // in this iframe so hovering the element shows the effect immediately. Keyed off data-igle-node
  // directly rather than assigning a real id, since nothing here needs to survive a reload. Plain
  // string search rather than a regex, since the selector's shape is fixed and fully known here —
  // nodeId is always numeric — so there's nothing that needs pattern-escaping.
  function setHoverPreviewStyle(nodeId, property, value) {
    var styleTag = document.getElementById("__igle_hover_preview__");
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "__igle_hover_preview__";
      document.head.appendChild(styleTag);
    }
    var selector = '[data-igle-node="' + nodeId + '"]:hover';
    var marker = selector + " {";
    var current = styleTag.textContent || "";
    var startIndex = current.indexOf(marker);
    var currentDecl = "";
    var before = current;
    var after = "";
    if (startIndex !== -1) {
      var braceStart = startIndex + marker.length;
      var braceEnd = current.indexOf("}", braceStart);
      if (braceEnd !== -1) {
        currentDecl = current.slice(braceStart, braceEnd);
        before = current.slice(0, startIndex);
        after = current.slice(braceEnd + 1);
      } else {
        startIndex = -1;
      }
    }
    var nextDecl = mergeDeclarationText(currentDecl, property, value);
    var newRule = selector + " { " + nextDecl + " }";
    styleTag.textContent = startIndex !== -1 ? before + newRule + after : current + "\\n" + newRule;
  }

  function rgbToHex(rgb) {
    var match = /^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(rgb || "");
    if (!match) return null;
    var toHex = function (n) {
      var h = parseInt(n, 10).toString(16);
      return h.length === 1 ? "0" + h : h;
    };
    return "#" + toHex(match[1]) + toHex(match[2]) + toHex(match[3]);
  }

  document.addEventListener(
    "mouseover",
    function (e) {
      var el = target(e.target);
      if (currentOutline && currentOutline !== el) currentOutline.style.outline = "";
      if (el) {
        el.style.outline = "2px solid #2f7d3f";
        el.style.outlineOffset = "-1px";
        currentOutline = el;
      }
    },
    true
  );

  document.addEventListener(
    "click",
    function (e) {
      var el = target(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      parent.postMessage({ source: "igle-preview", type: "select", element: describe(el) }, "*");
    },
    true
  );

  // Same targeting as click, plus immediately starts inline text editing — one motion instead of
  // click-to-select, then a separate "Edit text" click in the sidebar. Images have no inline text
  // to edit (they use the URL/upload form instead), so double-clicking one is a no-op here.
  document.addEventListener(
    "dblclick",
    function (e) {
      var el = target(e.target);
      if (!el || el.tagName === "IMG") return;
      e.preventDefault();
      e.stopPropagation();
      beginTextEdit(Number(el.getAttribute("data-igle-node")));
    },
    true
  );

  // Drag-and-drop for the Elements panel: the drag itself originates in the parent document (a
  // candidate row there), but dragover/drop fire normally on whatever's under the cursor —
  // including inside this cross-origin iframe — without any special cross-frame wiring needed, so
  // all the target-resolution logic can live here exactly like click/mouseover already do. The
  // parent only ever hears about the final drop (see "dropAccepted" below); the live drop
  // indicator while dragging is handled entirely in this frame, the same way the hover outline is.
  var dropIndicatorEl = null;
  var VOID_TAGS = { IMG: true, BR: true, HR: true, INPUT: true, META: true, LINK: true };

  function clearDropIndicator() {
    if (dropIndicatorEl) {
      dropIndicatorEl.style.outline = "";
      dropIndicatorEl.style.outlineOffset = "";
      dropIndicatorEl = null;
    }
  }

  // Top third of the hovered element -> "before" (new sibling above), bottom third -> "after",
  // middle third -> "append" (new last child) — except on a void element (an <img>, say, which
  // can't contain children at all), where the middle third falls back to "after" too, so dropping
  // near one of the Elements panel's own "Images" candidates doesn't land on an UNPATCHABLE_NODE
  // error from the server for the one case most likely to actually happen in practice.
  function resolveDropTarget(clientX, clientY) {
    var el = target(document.elementFromPoint(clientX, clientY));
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    var relativeY = clientY - rect.top;
    var third = rect.height / 3;
    var position;
    if (relativeY < third) position = "before";
    else if (relativeY > third * 2) position = "after";
    else position = VOID_TAGS[el.tagName] ? "after" : "append";
    return { nodeId: Number(el.getAttribute("data-igle-node")), position: position, el: el };
  }

  // The spec requires preventDefault() on BOTH dragenter and dragover for a drop to be accepted
  // at all — dragover alone isn't enough; without this, the browser silently refuses every drop
  // before the dragover handler below ever gets a chance to matter.
  document.addEventListener(
    "dragenter",
    function (e) {
      e.preventDefault();
    },
    true
  );

  document.addEventListener(
    "dragover",
    function (e) {
      e.preventDefault(); // required for this frame to accept a drop at all
      var resolved = resolveDropTarget(e.clientX, e.clientY);
      clearDropIndicator();
      if (resolved) {
        resolved.el.style.outline = "2px dashed #2f7d3f";
        resolved.el.style.outlineOffset = "-1px";
        dropIndicatorEl = resolved.el;
      }
    },
    true
  );

  document.addEventListener(
    "dragleave",
    function (e) {
      // relatedTarget is null when the drag leaves this document entirely (vs. just moving from
      // one element to another inside it, which dragover above already re-resolves on its own).
      if (!e.relatedTarget) clearDropIndicator();
    },
    true
  );

  document.addEventListener(
    "drop",
    function (e) {
      e.preventDefault();
      var resolved = resolveDropTarget(e.clientX, e.clientY);
      clearDropIndicator();
      if (resolved) {
        parent.postMessage({ source: "igle-preview", type: "dropAccepted", nodeId: resolved.nodeId, position: resolved.position }, "*");
      }
    },
    true
  );

  function beginTextEdit(nodeId) {
    var el = document.querySelector('[data-igle-node="' + nodeId + '"]');
    if (!el) return;
    el.setAttribute("contenteditable", "true");
    el.focus();
    var commit = function () {
      el.removeAttribute("contenteditable");
      parent.postMessage({ source: "igle-preview", type: "textEdited", nodeId: nodeId, html: innerHtmlWithoutNodeMarkers(el) }, "*");
    };
    el.addEventListener("blur", commit, { once: true });
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || e.data.source !== "igle-editor") return;
    var msg = e.data;

    if (msg.type === "setInnerHtml") {
      var toSetHtml = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (toSetHtml) toSetHtml.innerHTML = msg.html;
    }

    if (msg.type === "refresh") {
      window.location.reload();
    }

    if (msg.type === "selectNode") {
      var targetEl = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (targetEl) parent.postMessage({ source: "igle-preview", type: "select", element: describe(targetEl) }, "*");
    }

    if (msg.type === "getTree") {
      parent.postMessage({ source: "igle-preview", type: "tree", root: buildTree(document.body) }, "*");
    }

    if (msg.type === "getReusableElements") {
      parent.postMessage({ source: "igle-preview", type: "reusableElements", items: scanReusableElements() }, "*");
    }

    if (msg.type === "insertHtml") {
      var insertTarget = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (insertTarget && insertTarget.parentNode) {
        var container = document.createElement("div");
        container.innerHTML = msg.html;
        var toInsert = Array.prototype.slice.call(container.childNodes);
        if (msg.position === "before") {
          for (var bi = 0; bi < toInsert.length; bi++) insertTarget.parentNode.insertBefore(toInsert[bi], insertTarget);
        } else if (msg.position === "after") {
          // Each insert's own reference node advances, so a multi-node payload lands in the same
          // order it was captured in rather than reversed (insertTarget.nextSibling alone would
          // re-resolve to whatever was just inserted, putting every following node before it).
          var afterCursor = insertTarget;
          for (var ai = 0; ai < toInsert.length; ai++) {
            insertTarget.parentNode.insertBefore(toInsert[ai], afterCursor.nextSibling);
            afterCursor = toInsert[ai];
          }
        } else if (msg.position === "prepend") {
          // Reference captured once, before the loop starts, for the same reason as "after" above
          // — re-reading insertTarget.firstChild on every iteration would reverse the order.
          var prependRef = insertTarget.firstChild;
          for (var pi = 0; pi < toInsert.length; pi++) insertTarget.insertBefore(toInsert[pi], prependRef);
        } else {
          for (var ci = 0; ci < toInsert.length; ci++) insertTarget.appendChild(toInsert[ci]);
        }
      }
    }

    if (msg.type === "removeNode") {
      var toRemove = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (toRemove) toRemove.remove();
    }

    if (msg.type === "duplicateNode") {
      var toDuplicate = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (toDuplicate && toDuplicate.parentNode) {
        var clone = toDuplicate.cloneNode(true);
        toDuplicate.parentNode.insertBefore(clone, toDuplicate.nextSibling);
      }
    }

    if (msg.type === "moveUp" || msg.type === "moveDown") {
      // A real DOM node move (not a content swap) — the moved element keeps its own
      // data-igle-node attribute wherever it ends up, so the current selection (and any later
      // undo/redo replay keyed on that same nodeId) stays correctly pointed at it.
      var toMove = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (toMove && toMove.parentNode) {
        if (msg.type === "moveUp" && toMove.previousElementSibling) {
          toMove.parentNode.insertBefore(toMove, toMove.previousElementSibling);
        } else if (msg.type === "moveDown" && toMove.nextElementSibling) {
          toMove.parentNode.insertBefore(toMove.nextElementSibling, toMove);
        }
      }
    }

    if (msg.type === "wrapInAnchor") {
      var toWrap = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (toWrap && toWrap.parentNode) {
        var wrapper = document.createElement("a");
        wrapper.setAttribute("data-igle-cta", "default");
        wrapper.setAttribute("href", "#");
        wrapper.setAttribute("target", "_blank");
        wrapper.setAttribute("rel", "sponsored nofollow noopener noreferrer");
        toWrap.parentNode.insertBefore(wrapper, toWrap);
        wrapper.appendChild(toWrap);
      }
    }

    if (msg.type === "unwrapAnchor") {
      var toUnwrap = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      var wrapperEl = toUnwrap ? wrappingCtaAnchor(toUnwrap) : null;
      if (toUnwrap && wrapperEl && wrapperEl.parentNode) {
        wrapperEl.parentNode.insertBefore(toUnwrap, wrapperEl);
        wrapperEl.remove();
      }
    }

    // "important" priority — an inline style has the highest specificity of any *normal* CSS rule,
    // but real templates commonly use !important on button/CTA classes (color, gradients), which
    // would otherwise still win over a plain inline override. Without this, "change the background
    // color" silently does nothing on exactly the elements it's most often used for.
    if (msg.type === "setStyle") {
      var toStyle = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (toStyle) toStyle.style.setProperty(msg.property, msg.value, "important");
    }

    if (msg.type === "setHoverStyle") {
      setHoverPreviewStyle(msg.nodeId, msg.property, msg.value ? msg.value + " !important" : msg.value);
    }

    if (msg.type === "setAttr") {
      var toSetAttr = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (toSetAttr) {
        var attrValue = msg.value;
        // A <picture>'s <source siblings> render instead of this <img> whenever one matches —
        // live-updating just the img's src would silently show no change at all. Mirrors the
        // same rewrite the server does when the edit is actually saved (see
        // replaceImageSrcEverywhere in @igle/html-engine), so the instant preview matches what
        // you'll see after clicking Save.
        if (msg.attrName === "src" && toSetAttr.tagName === "IMG") {
          // A freshly-uploaded image's src is root-relative ("/media/x.png"). On a real page
          // load the server prefixes that with "/<siteSlug>/" (see rewriteAbsolutePaths) since
          // every site here is served under that prefix — but this DOM update never goes through
          // the server, so it needs the same prefix applied here, or the browser resolves it
          // against the preview origin's root and 404s (shows as a broken image until Save,
          // which reloads the page for real).
          attrValue = withSitePrefix(msg.value);
          var oldSrc = toSetAttr.getAttribute("src");
          var picture = toSetAttr.closest("picture");
          if (picture && oldSrc) {
            var sources = picture.querySelectorAll("source[srcset]");
            for (var i = 0; i < sources.length; i++) {
              var rewritten = rewriteSrcsetForOldSrc(sources[i].getAttribute("srcset"), oldSrc, attrValue);
              if (rewritten !== null) sources[i].setAttribute("srcset", rewritten);
            }
          }
        }
        toSetAttr.setAttribute(msg.attrName, attrValue);
      }
    }

    if (msg.type === "removeAttr") {
      var toRemoveAttr = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (toRemoveAttr) toRemoveAttr.removeAttribute(msg.attrName);
    }
  });
})();
`;

const port = Number(process.env.PREVIEW_PORT ?? 3001);
await app.listen({ host: "0.0.0.0", port });
