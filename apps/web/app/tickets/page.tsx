import Link from "next/link";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";

export const dynamic = "force-dynamic";

const priorityColor: Record<string, string> = {
  urgent: "var(--warn)",
  high: "var(--warn)",
  medium: "var(--accent)",
  low: "var(--muted)"
};

const specialistLabel: Record<string, string> = {
  developer: "Developer",
  designer: "Designer",
  seo: "SEO",
  copywriter: "Copywriter"
};

const statusLabel: Record<string, string> = {
  open: "Open",
  "in-progress": "In progress",
  done: "Done",
  cancelled: "Cancelled"
};

export default async function TicketsPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const [tickets, sites] = await Promise.all([runtime.ticketService.list(), runtime.siteService.list((await requireActorOrRedirect()))]);
  const sitesById = new Map(sites.map((site) => [site.id, site.metadata.name]));

  const sorted = tickets
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const openTickets = sorted.filter((ticket) => ticket.status !== "done" && ticket.status !== "cancelled");
  const closedTickets = sorted.filter((ticket) => ticket.status === "done" || ticket.status === "cancelled");

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Tickets</h1>
          <p className="muted">Tasks for developers, designers, SEO and copywriters. {openTickets.length} open.</p>
        </div>
      </div>

      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {error}
        </article>
      ) : null}

      <form
        className="card"
        method="post"
        action="/api/tickets"
        style={{ display: "grid", gap: 10, marginBottom: 28, maxWidth: 480 }}
      >
        <h2>New ticket</h2>
        <label className="muted" htmlFor="title">
          Title
        </label>
        <input type="text" id="title" name="title" required />

        <label className="muted" htmlFor="description">
          Description
        </label>
        <textarea id="description" name="description" rows={4} style={{ font: "inherit", padding: 8, borderRadius: 6, border: "1px solid var(--line)" }} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label className="muted" htmlFor="specialistType">
              Assign to
            </label>
            <select id="specialistType" name="specialistType" required>
              <option value="developer">Developer</option>
              <option value="designer">Designer</option>
              <option value="seo">SEO</option>
              <option value="copywriter">Copywriter</option>
            </select>
          </div>
          <div>
            <label className="muted" htmlFor="priority">
              Priority
            </label>
            <select id="priority" name="priority" defaultValue="medium">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label className="muted" htmlFor="siteId">
              Site (optional)
            </label>
            <select id="siteId" name="siteId">
              <option value="">No specific site</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.metadata.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="muted" htmlFor="deadline">
              Deadline (optional)
            </label>
            <input type="date" id="deadline" name="deadline" />
          </div>
        </div>

        <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 6 }}>
          Create ticket
        </button>
      </form>

      <h2>Open ({openTickets.length})</h2>
      <div className="list" style={{ marginBottom: 28 }}>
        {openTickets.map((ticket) => (
          <Link className="list-row" href={`/tickets/${ticket.id}`} key={ticket.id}>
            <div className="main">
              <h3>{ticket.title}</h3>
              <p className="muted">
                {specialistLabel[ticket.specialistType]}
                {ticket.siteId && sitesById.has(ticket.siteId) ? ` · ${sitesById.get(ticket.siteId)}` : ""}
                {ticket.deadline ? ` · Due ${ticket.deadline}` : ""}
              </p>
            </div>
            <span className="status" style={{ color: priorityColor[ticket.priority], borderColor: priorityColor[ticket.priority] }}>
              {ticket.priority}
            </span>
            <span className="status">{statusLabel[ticket.status]}</span>
          </Link>
        ))}
        {openTickets.length === 0 ? (
          <div className="list-row">
            <div className="main">
              <h3>No open tickets</h3>
              <p className="muted">Create one above to assign work to a specialist.</p>
            </div>
          </div>
        ) : null}
      </div>

      {closedTickets.length > 0 ? (
        <details>
          <summary style={{ cursor: "pointer", marginBottom: 10 }}>
            Closed ({closedTickets.length})
          </summary>
          <div className="list" style={{ marginBottom: 28 }}>
            {closedTickets.map((ticket) => (
              <Link className="list-row" href={`/tickets/${ticket.id}`} key={ticket.id}>
                <div className="main">
                  <h3>{ticket.title}</h3>
                  <p className="muted">
                    {specialistLabel[ticket.specialistType]}
                    {ticket.siteId && sitesById.has(ticket.siteId) ? ` · ${sitesById.get(ticket.siteId)}` : ""}
                  </p>
                </div>
                <span className="status">{statusLabel[ticket.status]}</span>
              </Link>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
