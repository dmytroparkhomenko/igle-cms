import Link from "next/link";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";

export const dynamic = "force-dynamic";

export default async function DeploymentsPage({
  searchParams
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  const { siteId } = await searchParams;
  const [deployments, sites] = await Promise.all([
    runtime.deployService.list(siteId),
    runtime.siteService.list((await requireActorOrRedirect()))
  ]);
  const sitesById = new Map(sites.map((site) => [site.id, site]));
  const filteredSite = siteId ? sitesById.get(siteId) : undefined;

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Deployments</h1>
          <p className="muted">{filteredSite ? `Deployment history for ${filteredSite.metadata.name}` : "Deployment history across all sites."}</p>
        </div>
        {filteredSite ? (
          <Link href="/deployments" className="button" style={{ background: "none", color: "var(--accent)" }}>
            Show all sites
          </Link>
        ) : null}
      </div>

      <div className="list" style={{ marginBottom: 28 }}>
        {deployments.map((deployment) => {
          const site = sitesById.get(deployment.siteId);
          const canRollback =
            deployment.target !== "aapanel" && deployment.status === "success" && site?.productionRevisionId !== deployment.revisionId;
          return (
            <div className="list-row" key={deployment.id} style={{ alignItems: "center" }}>
              <div className="main">
                <h3>
                  {site ? <Link href={`/sites/${site.id}`}>{site.metadata.name}</Link> : "Unknown site"} — revision #
                  {deployment.revisionNumber}
                  {deployment.target === "aapanel" ? " · aaPanel VPS" : ""}
                </h3>
                <p className="muted">
                  {deployment.kind === "rollback" ? "Rollback" : "Deploy"} · {new Date(deployment.createdAt).toLocaleString()}
                  {deployment.error ? ` · ${deployment.error}` : ""}
                  {deployment.sslError ? ` · SSL: ${deployment.sslError}` : ""}
                </p>
              </div>
              <span
                className="status"
                style={
                  deployment.status === "success"
                    ? { color: "var(--accent)", borderColor: "var(--accent)" }
                    : deployment.status === "failed"
                      ? { color: "var(--warn)", borderColor: "var(--warn)" }
                      : undefined
                }
              >
                {deployment.status}
              </span>
              {canRollback && site ? (
                <form method="post" action={`/api/sites/${site.id}/deployments/${deployment.id}/rollback`}>
                  <button className="button" type="submit" style={{ background: "none", color: "var(--warn)", fontSize: 12.5, padding: "6px 10px" }}>
                    Roll back to this
                  </button>
                </form>
              ) : null}
            </div>
          );
        })}
        {deployments.length === 0 ? (
          <div className="list-row">
            <div className="main">
              <h3>No deployments have run</h3>
              <p className="muted">Deploy a site to production from its site page to see history here.</p>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
