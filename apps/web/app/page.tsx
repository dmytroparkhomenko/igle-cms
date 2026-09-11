import { runtime } from "../lib/runtime";

export default async function DashboardPage() {
  const sites = await runtime.siteService.list(runtime.systemActor);
  const jobs = (await runtime.stateStore.read()).jobs.slice(-5).reverse();

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Draft and production status for static sites.</p>
        </div>
        <form action={runtime.createDemoSite}>
          <button className="button" type="submit">New demo site</button>
        </form>
      </div>
      <section className="grid">
        <article className="card">
          <div className="muted">Total sites</div>
          <h2>{sites.length}</h2>
        </article>
        <article className="card">
          <div className="muted">Published</div>
          <h2>{sites.filter((site) => site.metadata.status === "published").length}</h2>
        </article>
        <article className="card">
          <div className="muted">Recent jobs</div>
          <h2>{jobs.length}</h2>
        </article>
      </section>
      <h2>Sites</h2>
      <section className="grid">
        {sites.map((site) => (
          <article className="card" key={site.id}>
            <h3>{site.metadata.name}</h3>
            <p className="muted">{site.metadata.domain ?? "No production domain yet"}</p>
            <span className="status">{site.productionRevisionId ? "Production set" : "Never deployed"}</span>
          </article>
        ))}
      </section>
    </>
  );
}
