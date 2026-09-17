import fs from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import { JsonStateStore } from "@igle/core";
import { annotateNodesForEditing, neutralizeScripts } from "@igle/html-engine";
import { IgleError, resolveInside } from "@igle/shared";

const dataDir = process.env.IGLE_DATA_DIR ?? path.resolve(process.cwd(), "data");
const stateStore = new JsonStateStore(dataDir);
const app = Fastify({ logger: true });

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
  const tag = '<script src="/__igle/bridge.js"></script>';
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
 */
function rewriteAbsolutePaths(html: string, siteId: string): string {
  const prefix = `/${siteId}`;
  return html.replace(/(\s(?:src|href)=")\/(?!\/)([^"]*)(")/gi, `$1${prefix}/$2$3`);
}

const BRIDGE_SCRIPT = `(function () {
  "use strict";
  var currentOutline = null;

  function target(el) {
    return el && el.closest ? el.closest("[data-igle-node]") : null;
  }

  function describe(el) {
    var ancestors = [];
    var current = el.parentElement ? el.parentElement.closest("[data-igle-node]") : null;
    while (current) {
      ancestors.push({ nodeId: Number(current.getAttribute("data-igle-node")), tagName: current.tagName.toLowerCase() });
      current = current.parentElement ? current.parentElement.closest("[data-igle-node]") : null;
    }
    var computed = window.getComputedStyle(el);
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
      ancestors: ancestors
    };
  }

  function rgbToHex(rgb) {
    var match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || "");
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

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || e.data.source !== "igle-editor") return;
    var msg = e.data;

    if (msg.type === "startTextEdit") {
      var el = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (!el) return;
      el.setAttribute("contenteditable", "true");
      el.focus();
      var commit = function () {
        el.removeAttribute("contenteditable");
        parent.postMessage({ source: "igle-preview", type: "textEdited", nodeId: msg.nodeId, html: el.innerHTML }, "*");
      };
      el.addEventListener("blur", commit, { once: true });
    }

    if (msg.type === "refresh") {
      window.location.reload();
    }

    if (msg.type === "selectNode") {
      var target = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (target) parent.postMessage({ source: "igle-preview", type: "select", element: describe(target) }, "*");
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

    if (msg.type === "setStyle") {
      var toStyle = document.querySelector('[data-igle-node="' + msg.nodeId + '"]');
      if (toStyle) toStyle.style.setProperty(msg.property, msg.value);
    }
  });
})();
`;

const port = Number(process.env.PREVIEW_PORT ?? 3001);
await app.listen({ host: "0.0.0.0", port });
