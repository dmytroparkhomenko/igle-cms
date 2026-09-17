import Link from "next/link";
import { notFound } from "next/navigation";
import { runtime } from "../../../lib/runtime";
import { requireActorOrRedirect } from "../../../lib/session";

export const dynamic = "force-dynamic";

const specialistLabel: Record<string, string> = {
  developer: "Developer",
  designer: "Designer",
  seo: "SEO",
  copywriter: "Copywriter"
};

export default async function TicketDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<{ created?: string; updated?: string; commented?: string; error?: string }>;
}) {
  const { ticketId } = await params;
  const { created, updated, commented, error } = await searchParams;
  const ticket = await runtime.ticketService.get(ticketId);
  if (!ticket) notFound();

  const site = ticket.siteId ? await runtime.siteService.get(ticket.siteId, (await requireActorOrRedirect())) : undefined;
  const comments = ticket.comments.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>{ticket.title}</h1>
          <p className="muted">
            {specialistLabel[ticket.specialistType]}
            {site ? (
              <>
                {" · "}
                <Link href={`/sites/${site.id}`}>{site.metadata.name}</Link>
              </>
            ) : (
              " · No site"
            )}
            {ticket.deadline ? ` · Due ${ticket.deadline}` : ""}
          </p>
        </div>
        <Link href="/tickets" className="button" style={{ background: "none", color: "var(--accent)" }}>
          Back to tickets
        </Link>
      </div>

      {created ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Ticket created.
        </article>
      ) : null}
      {updated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Ticket updated.
        </article>
      ) : null}
      {commented ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Comment added.
        </article>
      ) : null}
      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {error}
        </article>
      ) : null}

      {ticket.description ? (
        <article className="card" style={{ marginBottom: 20, whiteSpace: "pre-wrap" }}>
          {ticket.description}
        </article>
      ) : null}

      <form
        method="post"
        action={`/api/tickets/${ticket.id}/update`}
        className="card"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 28, alignItems: "end" }}
      >
        <div>
          <label className="muted" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue={ticket.status}>
            <option value="open">Open</option>
            <option value="in-progress">In progress</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label className="muted" htmlFor="priority">
            Priority
          </label>
          <select id="priority" name="priority" defaultValue={ticket.priority}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label className="muted" htmlFor="specialistType">
            Assigned to
          </label>
          <select id="specialistType" name="specialistType" defaultValue={ticket.specialistType}>
            <option value="developer">Developer</option>
            <option value="designer">Designer</option>
            <option value="seo">SEO</option>
            <option value="copywriter">Copywriter</option>
          </select>
        </div>
        <div>
          <label className="muted" htmlFor="deadline">
            Deadline
          </label>
          <input type="date" id="deadline" name="deadline" defaultValue={ticket.deadline ?? ""} />
        </div>
        <button className="button" type="submit" style={{ gridColumn: "1 / -1", justifySelf: "start" }}>
          Save changes
        </button>
      </form>

      <h2>Comments ({comments.length})</h2>
      <div className="list" style={{ marginBottom: 20 }}>
        {comments.map((comment) => (
          <div className="list-row" key={comment.id} style={{ alignItems: "flex-start", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <strong>{comment.author}</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                {new Date(comment.createdAt).toLocaleString()}
              </span>
            </div>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{comment.body}</p>
          </div>
        ))}
        {comments.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>
              No comments yet.
            </p>
          </div>
        ) : null}
      </div>

      <form method="post" action={`/api/tickets/${ticket.id}/comments`} className="card" style={{ display: "grid", gap: 10, maxWidth: 480 }}>
        <label className="muted" htmlFor="author">
          Your name
        </label>
        <input type="text" id="author" name="author" required />
        <label className="muted" htmlFor="body">
          Comment
        </label>
        <textarea id="body" name="body" rows={3} required style={{ font: "inherit", padding: 8, borderRadius: 6, border: "1px solid var(--line)" }} />
        <button className="button" type="submit" style={{ justifySelf: "start" }}>
          Add comment
        </button>
      </form>
    </>
  );
}
