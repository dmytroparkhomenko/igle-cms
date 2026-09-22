import Link from "next/link";
import { runtime } from "../lib/runtime";
import { requireActorOrRedirect } from "../lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = await requireActorOrRedirect();
  const sites = await runtime.siteService.list(actor);
  const state = await runtime.stateStore.read();

  const published = sites.filter((site) => site.metadata.status === "published").length;
  const draft = sites.length - published;
  const deployedCount = sites.filter((site) => site.productionRevisionId).length;
  const teamCount = state.users.length;
  const myOpenTasks = state.tasks.filter(
    (task) => task.assigneeId === actor.id && task.status !== "done" && task.status !== "cancelled" && !task.archivedAt
  ).length;

  const siteById = new Map(sites.map((site) => [site.id, site]));
  const recentDeployments = state.deployments
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Signed in as {actor.email}.</p>
        </div>
      </div>

      <section className="grid" style={{ marginBottom: 28 }}>
        <article className="card">
          <div className="muted">Total sites</div>
          <h2>{sites.length}</h2>
        </article>
        <article className="card">
          <div className="muted">Published</div>
          <h2>{published}</h2>
        </article>
        <article className="card">
          <div className="muted">Draft</div>
          <h2>{draft}</h2>
        </article>
        <article className="card">
          <div className="muted">Deployed to production</div>
          <h2>{deployedCount}</h2>
        </article>
        <article className="card">
          <div className="muted">Team members</div>
          <h2>{teamCount}</h2>
        </article>
        <article className="card">
          <div className="muted">My open tasks</div>
          <h2>{myOpenTasks}</h2>
        </article>
      </section>

      <h2>Recent deployments</h2>
      <div className="list" style={{ marginBottom: 28 }}>
        {recentDeployments.map((deployment) => {
          const site = siteById.get(deployment.siteId);
          return (
            <div key={deployment.id} className="list-row">
              <div className="main">
                <h3>{site ? site.metadata.name : deployment.siteId}</h3>
                <p className="muted">
                  {deployment.target === "aapanel" ? "aaPanel VPS" : "Local filesystem"} · revision #{deployment.revisionNumber} ·{" "}
                  {new Date(deployment.createdAt).toLocaleString()}
                </p>
              </div>
              <span
                className="status"
                style={
                  deployment.status === "success"
                    ? { color: "var(--accent)", borderColor: "var(--accent)" }
                    : { color: "var(--warn)", borderColor: "var(--warn)" }
                }
              >
                {deployment.status}
              </span>
            </div>
          );
        })}
        {recentDeployments.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>No deployments yet.</p>
          </div>
        ) : null}
      </div>

      <h2>Quick links</h2>
      <section className="grid">
        <Link href="/sites" className="card card-link">
          <h3 style={{ margin: 0 }}>Sites</h3>
          <p className="muted" style={{ margin: "4px 0 0" }}>Manage and deploy your sites</p>
        </Link>
        <Link href="/templates" className="card card-link">
          <h3 style={{ margin: 0 }}>Templates</h3>
          <p className="muted" style={{ margin: "4px 0 0" }}>Launch a new site from a template</p>
        </Link>
        <Link href="/deployments" className="card card-link">
          <h3 style={{ margin: 0 }}>Deployments</h3>
          <p className="muted" style={{ margin: "4px 0 0" }}>Full deployment history</p>
        </Link>
        <Link href="/tasks" className="card card-link">
          <h3 style={{ margin: 0 }}>Tasks</h3>
          <p className="muted" style={{ margin: "4px 0 0" }}>Team task board and assignments</p>
        </Link>
        {actor.role === "administrator" ? (
          <Link href="/team" className="card card-link">
            <h3 style={{ margin: 0 }}>Team</h3>
            <p className="muted" style={{ margin: "4px 0 0" }}>Manage access and the team password</p>
          </Link>
        ) : null}
      </section>
    </>
  );
}
