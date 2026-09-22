import Link from "next/link";
import { taskCategoryLabels } from "@igle/shared";
import { runtime } from "../../../lib/runtime";
import { requireActorOrRedirect } from "../../../lib/session";

export const dynamic = "force-dynamic";

const statuses = ["open", "in-progress", "done", "cancelled"] as const;
const statusLabel: Record<string, string> = {
  open: "Open",
  "in-progress": "In progress",
  done: "Done",
  cancelled: "Cancelled"
};

export default async function TaskDashboardPage({
  searchParams
}: {
  searchParams: Promise<{ swept?: string; error?: string }>;
}) {
  const actor = await requireActorOrRedirect();
  const { swept, error } = await searchParams;

  if (actor.role !== "administrator") {
    return (
      <>
        <div className="toolbar">
          <h1>Task dashboard</h1>
        </div>
        <article className="card">
          <p className="muted" style={{ margin: 0 }}>Only administrators can view the task dashboard.</p>
        </article>
      </>
    );
  }

  const [tasks, members] = await Promise.all([runtime.taskService.list(), runtime.authService.listSelectable(actor)]);
  const membersById = new Map(members.map((member) => [member.id, member]));
  const today = new Date().toISOString().slice(0, 10);

  const active = tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const overdue = active.filter((task) => task.deadline && task.deadline < today).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  const unassigned = active.filter((task) => !task.assigneeId);

  const workload = members
    .map((member) => {
      const memberTasks = active.filter((task) => task.assigneeId === member.id);
      return {
        member,
        count: memberTasks.length,
        urgent: memberTasks.filter((task) => task.priority === "urgent" || task.priority === "high").length
      };
    })
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  const readyToArchive = tasks.filter((task) => task.status === "done" || task.status === "cancelled").length;

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Task dashboard</h1>
          <p className="muted">Team-wide view, administrators only.</p>
        </div>
        <Link href="/tasks" className="button" style={{ background: "none", color: "var(--accent)" }}>
          Back to tasks
        </Link>
      </div>

      {swept !== undefined ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Archived {swept} completed/cancelled task{swept === "1" ? "" : "s"}.
        </article>
      ) : null}
      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {error}
        </article>
      ) : null}

      <div className="settings-card" style={{ marginBottom: 28, maxWidth: 480 }}>
        <div className="settings-card-header">
          <h2>Weekly archive sweep</h2>
        </div>
        <div style={{ padding: 20, display: "grid", gap: 10 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Every Sunday, done and cancelled tasks are archived automatically ahead of the Monday–Saturday work week.
            {readyToArchive > 0 ? ` ${readyToArchive} task${readyToArchive === 1 ? " is" : "s are"} currently eligible.` : " Nothing is currently eligible."}
          </p>
          <form method="post" action="/api/tasks/archive-sweep">
            <button className="button" type="submit" disabled={readyToArchive === 0} style={{ justifySelf: "start" }}>
              Archive now
            </button>
          </form>
        </div>
      </div>

      <section className="grid" style={{ marginBottom: 28 }}>
        {statuses.map((status) => (
          <article className="card" key={status}>
            <div className="muted">{statusLabel[status]}</div>
            <h2>{tasks.filter((task) => task.status === status).length}</h2>
          </article>
        ))}
        <article className="card">
          <div className="muted">Overdue</div>
          <h2 style={overdue.length > 0 ? { color: "var(--warn)" } : undefined}>{overdue.length}</h2>
        </article>
        <article className="card">
          <div className="muted">Unassigned</div>
          <h2>{unassigned.length}</h2>
        </article>
      </section>

      <h2>Overdue ({overdue.length})</h2>
      <div className="list" style={{ marginBottom: 28 }}>
        {overdue.map((task) => {
          const assignee = task.assigneeId ? membersById.get(task.assigneeId) : undefined;
          return (
            <Link className="list-row" href={`/tasks/${task.id}`} key={task.id}>
              <div className="main">
                <h3>{task.title}</h3>
                <p className="muted">
                  Due {task.deadline} · {taskCategoryLabels[task.category]}
                </p>
              </div>
              <span className="status" style={{ color: assignee ? "var(--text)" : "var(--muted)" }}>
                {assignee ? assignee.name || assignee.email : "Unassigned"}
              </span>
            </Link>
          );
        })}
        {overdue.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>Nothing overdue.</p>
          </div>
        ) : null}
      </div>

      <h2>Workload</h2>
      <div className="list" style={{ marginBottom: 28 }}>
        {workload.map(({ member, count, urgent }) => (
          <div className="list-row" key={member.id}>
            <div className="main">
              <h3>{member.name || member.email}</h3>
              <p className="muted">
                {count} open task{count === 1 ? "" : "s"}
                {urgent > 0 ? ` · ${urgent} high/urgent` : ""}
                {member.tags.length > 0 ? ` · ${member.tags.map((tag) => taskCategoryLabels[tag]).join(", ")}` : ""}
              </p>
            </div>
          </div>
        ))}
        {workload.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>No one has open tasks assigned.</p>
          </div>
        ) : null}
      </div>

      <h2>Unassigned ({unassigned.length})</h2>
      <div className="list">
        {unassigned.map((task) => (
          <Link className="list-row" href={`/tasks/${task.id}`} key={task.id}>
            <div className="main">
              <h3>{task.title}</h3>
              <p className="muted">
                {taskCategoryLabels[task.category]}
                {task.deadline ? ` · Due ${task.deadline}` : ""}
              </p>
            </div>
            <span className="status">{statusLabel[task.status]}</span>
          </Link>
        ))}
        {unassigned.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>Everything active has an assignee.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
