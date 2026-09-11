import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.env.PORT ?? 3100);
const dataDir = process.env.IGLE_DATA_DIR ?? path.resolve(process.cwd(), "data");
const statePath = path.join(dataDir, "state.json");

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `localhost:${port}`}`);

    if (url.pathname === "/health") {
      return json(response, { ok: true });
    }

    if (url.pathname === "/api/sites") {
      const state = await readState();
      return json(response, { sites: state.sites });
    }

    if (url.pathname === "/api/jobs") {
      const state = await readState();
      return json(response, { jobs: state.jobs });
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(await renderPage(url.pathname));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: { code: "LAUNCHER_ERROR", message: error instanceof Error ? error.message : "Unknown error" } }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Igle CMS fallback launcher ready at http://localhost:${port}`);
});

async function renderPage(pathname) {
  const state = await readState();
  const sites = state.sites ?? [];
  const jobs = state.jobs ?? [];
  const published = sites.filter((site) => site.productionRevisionId).length;
  const route = normalizeRoute(pathname);
  const content = renderRoute(route, { sites, jobs, published });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Igle CMS</title>
    <style>
      :root { --bg:#f7f8fb; --panel:#fff; --line:#d8dee8; --text:#20242c; --muted:#667085; --accent:#146c64; }
      * { box-sizing: border-box; }
      body { margin:0; background:var(--bg); color:var(--text); font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .shell { display:grid; grid-template-columns:240px 1fr; min-height:100vh; }
      aside { border-right:1px solid var(--line); background:#fff; padding:24px 18px; }
      .brand { font-weight:700; font-size:20px; margin-bottom:28px; }
      nav { display:grid; gap:8px; }
      nav a { border-radius:6px; padding:9px 10px; color:var(--muted); text-decoration:none; }
      nav a.active { background:#e8f4f2; color:var(--accent); }
      main { padding:28px; }
      .toolbar { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:20px; }
      .actions { display:flex; flex-wrap:wrap; gap:10px; margin:16px 0 28px; }
      .button { display:inline-flex; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:6px; padding:9px 12px; font-weight:650; text-decoration:none; cursor:pointer; }
      .button.secondary { background:#fff; color:var(--accent); }
      h1 { margin:0 0 8px; font-size:32px; letter-spacing:0; }
      h2 { margin:0 0 8px; font-size:20px; letter-spacing:0; }
      h3 { margin:0 0 6px; font-size:17px; letter-spacing:0; }
      .muted { color:var(--muted); }
      .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:14px; margin:16px 0 28px; }
      .card { border:1px solid var(--line); border-radius:8px; background:var(--panel); padding:16px; }
      .status { display:inline-flex; border:1px solid var(--line); border-radius:999px; padding:3px 8px; color:var(--muted); font-size:12px; }
      @media (max-width: 720px) { .shell { grid-template-columns:1fr; } aside { border-right:0; border-bottom:1px solid var(--line); } }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside>
        <div class="brand">Igle CMS</div>
        <nav>
          ${navLink("/", "Dashboard", route)}
          ${navLink("/sites", "Sites", route)}
          ${navLink("/templates", "Templates", route)}
          ${navLink("/integrations", "Integrations", route)}
          ${navLink("/deployments", "Deployments", route)}
          ${navLink("/jobs", "Jobs", route)}
          ${navLink("/settings", "Settings", route)}
        </nav>
      </aside>
      <main>
        ${content}
      </main>
    </div>
  </body>
</html>`;
}

function renderRoute(route, { sites, jobs, published }) {
  if (route === "/sites") {
    return `${header("Sites", "Static site workspaces backed by Git revisions.")}
      <section class="grid">
        ${
          sites.length
            ? sites
                .map(
                  (site) => `<article class="card">
            <h2>${escapeHtml(site.metadata?.name ?? site.slug ?? site.id)}</h2>
            <p class="muted">${escapeHtml(site.metadata?.domain ?? "Domain not configured")}</p>
            <p>${escapeHtml(site.metadata?.language ?? "en")} · ${escapeHtml(site.metadata?.status ?? "draft")}</p>
            <span class="status">${site.productionRevisionId ? "Production configured" : "Never deployed"}</span>
          </article>`
                )
                .join("")
            : emptyCard("No sites yet", "No site workspaces have been created.")
        }
      </section>`;
  }

  if (route === "/jobs") {
    return `${header("Jobs", "Background work and progress events.")}
      <section class="grid">
        ${
          jobs.length
            ? jobs
                .map(
                  (job) => `<article class="card">
            <h2>${escapeHtml(job.type)}</h2>
            <p>${escapeHtml(job.progress ?? 0)}% · ${escapeHtml(job.status)}</p>
            <p class="muted">${escapeHtml(job.message ?? "")}</p>
          </article>`
                )
                .join("")
            : emptyCard("No jobs", "No background work has run.")
        }
      </section>`;
  }

  if (route === "/templates") return `${header("Templates", "Template packages and starter designs.")}<section class="grid">${emptyCard("No templates uploaded", "The starter template files are present in the repository.")}</section>`;
  if (route === "/integrations") return `${header("Integrations", "Verification, scripts, and provider configuration.")}<section class="grid">${emptyCard("No integrations configured", "No site integration is active.")}</section>`;
  if (route === "/deployments") return `${header("Deployments", "Builds, releases, smoke checks, and rollback history.")}<section class="grid">${emptyCard("No deployments", "No deployment has run.")}</section>`;
  if (route === "/settings") return `${header("Settings", "Users, servers, AI providers, prompts, and notifications.")}<section class="grid">${emptyCard("Settings", "No settings have been configured.")}</section>`;

  return `${header("Dashboard", "Draft and production status for static sites.")}
    <section class="actions">
      <a class="button" href="/sites">Open sites</a>
      <a class="button secondary" href="/jobs">Open jobs</a>
    </section>
    <section class="grid">
      <article class="card"><div class="muted">Total sites</div><h2>${sites.length}</h2></article>
      <article class="card"><div class="muted">Published</div><h2>${published}</h2></article>
      <article class="card"><div class="muted">Recent jobs</div><h2>${jobs.length}</h2></article>
    </section>
    <h2>Sites</h2>
    <section class="grid">
      ${
        sites.length
          ? sites
              .map(
                (site) => `<article class="card">
          <h3>${escapeHtml(site.metadata?.name ?? site.slug ?? site.id)}</h3>
          <p class="muted">${escapeHtml(site.metadata?.domain ?? "Domain not configured")}</p>
          <span class="status">${site.productionRevisionId ? "Production configured" : "Never deployed"}</span>
        </article>`
              )
              .join("")
          : emptyCard("No sites yet", "No site workspaces have been created.")
      }
    </section>`;
}

function header(title, subtitle) {
  return `<div class="toolbar">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <p class="muted">${escapeHtml(subtitle)}</p>
    </div>
    <span class="status">Fallback launcher</span>
  </div>`;
}

function emptyCard(title, body) {
  return `<article class="card"><h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(body)}</p></article>`;
}

function navLink(href, label, route) {
  const active = route === href ? " active" : "";
  return `<a class="${active}" href="${href}">${escapeHtml(label)}</a>`;
}

function normalizeRoute(pathname) {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const allowed = new Set(["/", "/sites", "/templates", "/integrations", "/deployments", "/jobs", "/settings"]);
  return allowed.has(clean) ? clean : "/";
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { sites: [], revisions: [], pages: [], users: [], invites: [], sessions: [], drafts: [], jobs: [] };
    }
    throw error;
  }
}

function json(response, value) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
