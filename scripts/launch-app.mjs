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
    response.end(await renderDashboard());
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: { code: "LAUNCHER_ERROR", message: error instanceof Error ? error.message : "Unknown error" } }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Igle CMS fallback launcher ready at http://localhost:${port}`);
});

async function renderDashboard() {
  const state = await readState();
  const sites = state.sites ?? [];
  const jobs = state.jobs ?? [];
  const published = sites.filter((site) => site.productionRevisionId).length;

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
      nav a:first-child { background:#e8f4f2; color:var(--accent); }
      main { padding:28px; }
      .toolbar { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:20px; }
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
          <a href="/">Dashboard</a>
          <a href="/sites">Sites</a>
          <a href="/jobs">Jobs</a>
          <a href="/settings">Settings</a>
        </nav>
      </aside>
      <main>
        <div class="toolbar">
          <div>
            <h1>Dashboard</h1>
            <p class="muted">Draft and production status for static sites.</p>
          </div>
          <span class="status">Fallback launcher</span>
        </div>
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
              : `<article class="card"><h3>No sites yet</h3><p class="muted">No site workspaces have been created.</p></article>`
          }
        </section>
      </main>
    </div>
  </body>
</html>`;
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
