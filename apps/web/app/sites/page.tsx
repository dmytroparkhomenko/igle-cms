import { runtime } from "../../lib/runtime";

export default async function SitesPage() {
  const sites = await runtime.siteService.list(runtime.systemActor);
  const state = await runtime.stateStore.read();

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Sites</h1>
          <p className="muted">Static site workspaces backed by Git revisions.</p>
        </div>
      </div>
      <section className="grid">
        {sites.map((site) => {
          const revisions = state.revisions.filter((revision) => revision.siteId === site.id);
          const pages = state.pages.filter((page) => page.siteId === site.id);
          return (
            <article className="card" key={site.id}>
              <h2>{site.metadata.name}</h2>
              <p className="muted">{site.metadata.domain ?? "Domain not configured"}</p>
              <p>{pages.length} pages · Revision #{revisions.at(-1)?.revisionNumber ?? 0}</p>
              <span className="status">{site.productionRevisionId ? "Production configured" : "Never deployed"}</span>
            </article>
          );
        })}
        {sites.length === 0 ? (
          <article className="card">
            <h2>No sites yet</h2>
          <p className="muted">No site workspaces have been created.</p>
          </article>
        ) : null}
      </section>
    </>
  );
}
