import Link from "next/link";
import { runtime } from "../../../lib/runtime";
import { requireActorOrRedirect } from "../../../lib/session";
import { DeleteSiteButton } from "../DeleteSiteButton";
import type { SiteRecord } from "../../../../../packages/core/src/types";

export const dynamic = "force-dynamic";

/**
 * Groups sites that share the same name — for anything imported from an aaPanel server, the name
 * is always set to the raw domain text (see RemoteSiteImportService.importOneSite), so two sites
 * with the same name are, in practice, the same real-world site imported twice. That happens when
 * the second copy's domain assignment hits DOMAIN_IN_USE (the first copy already claimed it) and
 * is left domain-less — see the fix in RemoteSiteImportService for why this could happen at all.
 * Mirror pairs are deliberately excluded: a mirror's name is unrelated to this bug and grouping it
 * in would just be noise.
 */
function findDuplicateGroups(sites: SiteRecord[]): SiteRecord[][] {
  const mirrorSiteIds = new Set<string>();
  for (const site of sites) {
    if (site.metadata.mirrorOfSiteId) {
      mirrorSiteIds.add(site.id);
      mirrorSiteIds.add(site.metadata.mirrorOfSiteId);
    }
  }
  const byName = new Map<string, SiteRecord[]>();
  for (const site of sites) {
    if (mirrorSiteIds.has(site.id)) continue;
    const key = site.metadata.name.trim().toLowerCase();
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(site);
    byName.set(key, list);
  }
  return [...byName.values()].filter((group) => group.length > 1);
}

export default async function DuplicateSitesPage() {
  const actor = await requireActorOrRedirect();
  if (actor.role !== "administrator") {
    return (
      <>
        <div className="toolbar">
          <h1>Duplicate sites</h1>
        </div>
        <article className="card">
          <p className="muted" style={{ margin: 0 }}>Only administrators can review duplicates.</p>
        </article>
      </>
    );
  }

  const state = await runtime.stateStore.read();
  const groups = findDuplicateGroups(state.sites).sort((a, b) => b.length - a.length);

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Duplicate sites</h1>
          <p className="muted">
            {groups.length} group{groups.length === 1 ? "" : "s"} · {groups.reduce((sum, g) => sum + g.length, 0)} sites involved
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/servers/imports" className="button button-ghost">
            Import activity
          </Link>
          <Link href="/sites" className="button button-ghost">
            Back to sites
          </Link>
        </div>
      </div>

      <article className="card" style={{ marginBottom: 20, fontSize: 13.5 }}>
        <p style={{ margin: 0 }}>
          Each group below shares the same name — for anything auto-imported from a server, that means the same domain was
          imported more than once. Within a group, the copy with a domain assigned and a deploy history is almost always the
          real one; a domain-less copy with no deploys is almost always the orphan left behind by a failed re-import.{" "}
          <strong>Nothing here is deleted automatically</strong> — review each group and delete the copy you don&apos;t want.
        </p>
      </article>

      {groups.length === 0 ? (
        <div className="list">
          <div className="list-row">
            <div className="main">
              <h3>No duplicates found</h3>
              <p className="muted">Every site currently has a unique name.</p>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        {groups.map((group) => {
          const sorted = group.slice().sort((a, b) => {
            const aHasDomain = Boolean(a.metadata.domain);
            const bHasDomain = Boolean(b.metadata.domain);
            if (aHasDomain !== bHasDomain) return aHasDomain ? -1 : 1;
            const aDeployed = Boolean(a.productionRevisionId);
            const bDeployed = Boolean(b.productionRevisionId);
            if (aDeployed !== bDeployed) return aDeployed ? -1 : 1;
            return a.metadata.createdAt.localeCompare(b.metadata.createdAt);
          });
          const recommendedKeepId = Boolean(sorted[0]?.metadata.domain) || Boolean(sorted[0]?.productionRevisionId) ? sorted[0]!.id : undefined;

          return (
            <article className="card" key={group[0]!.metadata.name}>
              <h2 style={{ marginBottom: 12 }}>{group[0]!.metadata.name}</h2>
              <div className="list">
                {sorted.map((site) => {
                  const pageCount = state.pages.filter((page) => page.siteId === site.id && !page.deletedAt).length;
                  const revisions = state.revisions.filter((revision) => revision.siteId === site.id);
                  const headRevisionNumber = revisions.at(-1)?.revisionNumber ?? 0;
                  const isRecommendedKeep = site.id === recommendedKeepId;
                  const server = site.metadata.serverId ? state.servers.find((item) => item.id === site.metadata.serverId) : undefined;

                  return (
                    <div className="list-row" key={site.id}>
                      <div className="main">
                        <h3>
                          <Link href={`/sites/${site.id}`}>{site.slug}</Link>
                        </h3>
                        <p className="muted">
                          {site.metadata.domain ?? "No domain"} · {pageCount} page{pageCount === 1 ? "" : "s"} · Rev #{headRevisionNumber}
                          {" · "}
                          {site.productionRevisionId ? "Deployed" : "Never deployed"}
                          {server ? ` · ${server.name}` : ""}
                          {" · created "}
                          {new Date(site.metadata.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      {recommendedKeepId ? (
                        <span className={`chip ${isRecommendedKeep ? "chip-medium" : "chip-urgent"}`}>
                          {isRecommendedKeep ? "Likely the real one" : "Likely duplicate"}
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>
                          Unclear — compare manually
                        </span>
                      )}
                      <DeleteSiteButton siteId={site.id} slug={site.slug} label={site.metadata.name} />
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
