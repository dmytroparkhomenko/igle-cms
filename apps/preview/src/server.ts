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
      html: el.innerHTML,
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
      dataIgleCta: el.getAttribute("data-igle-cta"),
      wrappedInCta: Boolean(wrappingCtaAnchor(el)),
      hasPrevSibling: siblingIndex > 0,
      hasNextSibling: siblingIndex !== -1 && siblingIndex < siblingElements.length - 1,
      ancestors: ancestors
    };
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

  function beginTextEdit(nodeId) {
    var el = document.querySelector('[data-igle-node="' + nodeId + '"]');
    if (!el) return;
    el.setAttribute("contenteditable", "true");
    el.focus();
    var commit = function () {
      el.removeAttribute("contenteditable");
      parent.postMessage({ source: "igle-preview", type: "textEdited", nodeId: nodeId, html: el.innerHTML }, "*");
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
