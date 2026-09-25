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

const statusLabel: Record<string, string> = {
  open: "Open",
  "in-progress": "In progress",
  done: "Done",
  cancelled: "Cancelled"
};

const statuses = ["open", "in-progress", "done", "cancelled"] as const;

export default async function TasksPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; assignee?: string; view?: string; archived?: string }>;
}) {
  const actor = await requireActorOrRedirect();
  const { error, assignee, view, archived } = await searchParams;
  const isAdmin = actor.role === "administrator";
  const [tasks, sites, members] = await Promise.all([
    runtime.taskService.list(),
    runtime.siteService.list(actor),
    runtime.authService.listSelectable(actor)
  ]);
  const sitesById = new Map(sites.map((site) => [site.id, site.metadata.name]));
  const membersById = new Map(members.map((member) => [member.id, member]));

  const assigneeFilter = assignee ?? "all";
  const filtered = tasks.filter((task) => {
    if (assigneeFilter === "all") return true;
    if (assigneeFilter === "unassigned") return !task.assigneeId;
    if (assigneeFilter === "mine") return task.assigneeId === actor.id;
    return task.assigneeId === assigneeFilter;
  });

  const sorted = filtered.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const openTasks = sorted.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const closedTasks = sorted.filter((task) => task.status === "done" || task.status === "cancelled");
  const boardView = view === "board";

  const chips: Array<{ value: string; label: string }> = [
    { value: "all", label: "All" },
    { value: "mine", label: "Mine" },
    ...members.map((member) => ({ value: member.id, label: member.name || member.email })),
    { value: "unassigned", label: "Unassigned" }
  ];

  const listHref = `/tasks?${new URLSearchParams({ view: "list", ...(assigneeFilter !== "all" ? { assignee: assigneeFilter } : {}) }).toString()}`;
  const boardHref = `/tasks?${new URLSearchParams({ view: "board", ...(assigneeFilter !== "all" ? { assignee: assigneeFilter } : {}) }).toString()}`;

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Tasks</h1>
          <p className="muted">{openTasks.length} open.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href={listHref} className="button" style={!boardView ? { color: "var(--accent)" } : { background: "none", color: "var(--muted)" }}>
            List
          </Link>
          <Link href={boardHref} className="button" style={boardView ? { color: "var(--accent)" } : { background: "none", color: "var(--muted)" }}>
            Board
          </Link>
          {isAdmin ? (
            <Link href="/tasks/dashboard" className="button" style={{ background: "none", color: "var(--accent)" }}>
              Dashboard
            </Link>
          ) : null}
          {isAdmin ? (
            <Link href="/tasks/archive" className="button" style={{ background: "none", color: "var(--muted)", fontSize: 12.5 }}>
              Archive
            </Link>
          ) : null}
        </div>
      </div>

      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {error}
        </article>
      ) : null}
      {archived ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Task archived.
        </article>
      ) : null}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
        {chips.map((chip) => {
          const active = assigneeFilter === chip.value;
          const params = new URLSearchParams({ ...(boardView ? { view: "board" } : {}), ...(chip.value === "all" ? {} : { assignee: chip.value }) });
          const query = params.toString();
          return (
            <Link
              key={chip.value}
              href={query ? `/tasks?${query}` : "/tasks"}
              className="status"
              style={active ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" } : undefined}
            >
              {chip.label}
            </Link>
          );
        })}
      </div>

      <form
        className="card"
        method="post"
        action="/api/tasks"
        style={{ display: "grid", gap: 10, marginBottom: 28, maxWidth: 480 }}
      >
        <h2>New task</h2>
        <label className="muted" htmlFor="title">
          Title
        </label>
        <input type="text" id="title" name="title" required />

        <label className="muted" htmlFor="description">
          Description
        </label>
        <textarea id="description" name="description" rows={4} style={{ font: "inherit", padding: 8, borderRadius: 6, border: "1px solid var(--line)" }} />

        <label className="muted" htmlFor="assigneeId">
          Assign to
        </label>
        <select id="assigneeId" name="assigneeId" defaultValue={actor.id}>
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name || member.email}
            </option>
          ))}
        </select>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
          <div>
            <label className="muted" htmlFor="deadline">
              Deadline (optional)
            </label>
            <input type="date" id="deadline" name="deadline" />
          </div>
        </div>

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

        <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 6 }}>
          Create task
        </button>
      </form>

      {boardView ? (
        <div className="board" style={{ marginBottom: 28 }}>
          {statuses.map((status) => {
            const columnTasks = sorted.filter((task) => task.status === status);
            return (
              <div className="board-column" key={status}>
                <h3>
                  {statusLabel[status]} <span className="muted">({columnTasks.length})</span>
                </h3>
                {columnTasks.map((task) => {
                  const assignee = task.assigneeId ? membersById.get(task.assigneeId) : undefined;
                  return (
                    <Link className="card" href={`/tasks/${task.id}`} key={task.id} style={{ display: "block", marginBottom: 10 }}>
                      <strong style={{ display: "block", marginBottom: 4 }}>{task.title}</strong>
                      <p className="muted" style={{ margin: "0 0 6px", fontSize: 12.5 }}>
                        {task.deadline ? `Due ${task.deadline}` : ""}
                      </p>
                      <span className="status" style={{ color: priorityColor[task.priority], borderColor: priorityColor[task.priority], fontSize: 11 }}>
                        {task.priority}
                      </span>{" "}
                      <span className="status" style={{ fontSize: 11, color: assignee ? "var(--text)" : "var(--muted)" }}>
                        {assignee ? assignee.name || assignee.email : "Unassigned"}
                      </span>
                    </Link>
                  );
                })}
                {columnTasks.length === 0 ? <p className="muted" style={{ fontSize: 12.5 }}>Nothing here.</p> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <h2>Open ({openTasks.length})</h2>
          <div className="list" style={{ marginBottom: 28 }}>
            {openTasks.map((task) => {
              const assignee = task.assigneeId ? membersById.get(task.assigneeId) : undefined;
              return (
                <Link className="list-row" href={`/tasks/${task.id}`} key={task.id}>
                  <div className="main">
                    <h3>{task.title}</h3>
                    <p className="muted">
                      {[task.siteId && sitesById.has(task.siteId) ? sitesById.get(task.siteId) : undefined, task.deadline ? `Due ${task.deadline}` : undefined]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="status" style={{ color: assignee ? "var(--text)" : "var(--muted)" }}>
                    {assignee ? assignee.name || assignee.email : "Unassigned"}
                  </span>
                  <span className="status" style={{ color: priorityColor[task.priority], borderColor: priorityColor[task.priority] }}>
                    {task.priority}
                  </span>
                  <span className="status">{statusLabel[task.status]}</span>
                </Link>
              );
            })}
            {openTasks.length === 0 ? (
              <div className="list-row">
                <div className="main">
                  <h3>No open tasks</h3>
                  <p className="muted">Create one above to assign work to the team.</p>
                </div>
              </div>
            ) : null}
          </div>

          {closedTasks.length > 0 ? (
            <details>
              <summary style={{ cursor: "pointer", marginBottom: 10 }}>Closed ({closedTasks.length})</summary>
              <div className="list" style={{ marginBottom: 28 }}>
                {closedTasks.map((task) => {
                  const assignee = task.assigneeId ? membersById.get(task.assigneeId) : undefined;
                  return (
                    <Link className="list-row" href={`/tasks/${task.id}`} key={task.id}>
                      <div className="main">
                        <h3>{task.title}</h3>
                        <p className="muted">
                          {task.siteId && sitesById.has(task.siteId) ? sitesById.get(task.siteId) : ""}
                        </p>
                      </div>
                      <span className="status" style={{ color: assignee ? "var(--text)" : "var(--muted)" }}>
                        {assignee ? assignee.name || assignee.email : "Unassigned"}
                      </span>
                      <span className="status">{statusLabel[task.status]}</span>
                    </Link>
                  );
                })}
              </div>
            </details>
          ) : null}
        </>
      )}
    </>
  );
}
