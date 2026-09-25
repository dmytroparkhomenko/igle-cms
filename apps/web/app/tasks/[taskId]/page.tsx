import Link from "next/link";
import { notFound } from "next/navigation";
import { runtime } from "../../../lib/runtime";
import { requireActorOrRedirect } from "../../../lib/session";
import { DeleteTaskButton } from "../DeleteTaskButton";

export const dynamic = "force-dynamic";

const activityVerb: Record<string, string> = {
  created: "created this task",
  "status-changed": "changed status",
  "priority-changed": "changed priority",
  reassigned: "reassigned this task",
  "deadline-changed": "changed the deadline",
  "checklist-item-added": "added a checklist item",
  "checklist-item-toggled": "toggled a checklist item",
  "checklist-item-removed": "removed a checklist item",
  "attachment-added": "added an attachment",
  "attachment-removed": "removed an attachment",
  archived: "archived this task",
  unarchived: "restored this task from the archive"
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function TaskDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ created?: string; updated?: string; commented?: string; error?: string }>;
}) {
  const { taskId } = await params;
  const { created, updated, commented, error } = await searchParams;
  const actor = await requireActorOrRedirect();
  const task = await runtime.taskService.get(taskId);
  if (!task) notFound();

  const [site, members] = await Promise.all([
    task.siteId ? runtime.siteService.get(task.siteId, actor) : Promise.resolve(undefined),
    runtime.authService.listSelectable(actor),
    runtime.notificationService.markReadForTask(actor, taskId)
  ]);
  const membersById = new Map(members.map((member) => [member.id, member]));
  const assignee = task.assigneeId ? membersById.get(task.assigneeId) : undefined;
  const creator = task.creatorId ? membersById.get(task.creatorId) : undefined;
  const comments = task.comments.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const activity = task.activity.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const isOwner = actor.role === "administrator" || task.assigneeId === actor.id || task.creatorId === actor.id;
  const isAdmin = actor.role === "administrator";

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>{task.title}</h1>
          <p className="muted">
            {assignee ? assignee.name || assignee.email : "Unassigned"}
            {creator ? ` · Created by ${creator.name || creator.email}` : ""}
            {site ? (
              <>
                {" · "}
                <Link href={`/sites/${site.id}`}>{site.metadata.name}</Link>
              </>
            ) : (
              " · No site"
            )}
            {task.deadline ? ` · Due ${task.deadline}` : ""}
            {task.archivedAt ? " · Archived" : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {isAdmin && !task.archivedAt ? (
            <form method="post" action={`/api/tasks/${task.id}/archive`}>
              <button className="button" type="submit" style={{ background: "none", color: "var(--warn)" }}>
                Archive
              </button>
            </form>
          ) : null}
          {isAdmin && task.archivedAt ? (
            <form method="post" action={`/api/tasks/${task.id}/unarchive`}>
              <button className="button" type="submit" style={{ background: "none", color: "var(--accent)" }}>
                Restore
              </button>
            </form>
          ) : null}
          {isAdmin ? <DeleteTaskButton taskId={task.id} title={task.title} /> : null}
          <Link href="/tasks" className="button" style={{ background: "none", color: "var(--accent)" }}>
            Back to tasks
          </Link>
        </div>
      </div>

      {created ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Task created.
        </article>
      ) : null}
      {updated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Task updated.
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

      {task.description ? (
        <article className="card" style={{ marginBottom: 20, whiteSpace: "pre-wrap" }}>
          {task.description}
        </article>
      ) : null}

      {isOwner ? (
        <form
          method="post"
          action={`/api/tasks/${task.id}/update`}
          className="card"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 28, alignItems: "end" }}
        >
          <div>
            <label className="muted" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={task.status}>
              <option value="open">Open</option>
              <option value="in-progress">In progress</option>
              <option value="done">Done</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className="muted" htmlFor="assigneeId">
              Assignee
            </label>
            <select id="assigneeId" name="assigneeId" defaultValue={task.assigneeId ?? ""}>
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name || member.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="muted" htmlFor="priority">
              Priority
            </label>
            <select id="priority" name="priority" defaultValue={task.priority}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label className="muted" htmlFor="deadline">
              Deadline
            </label>
            <input type="date" id="deadline" name="deadline" defaultValue={task.deadline ?? ""} />
          </div>
          <button className="button" type="submit" style={{ gridColumn: "1 / -1", justifySelf: "start" }}>
            Save changes
          </button>
        </form>
      ) : (
        <article className="card" style={{ marginBottom: 28 }}>
          <p className="muted" style={{ margin: 0 }}>
            Only the assignee, creator, or an administrator can edit this task's status, priority, deadline, or assignee.
          </p>
        </article>
      )}

      <h2>Checklist ({task.checklist.filter((item) => item.done).length}/{task.checklist.length})</h2>
      <div className="list" style={{ marginBottom: 20 }}>
        {task.checklist.map((item) => {
          const itemAssignee = item.assigneeId ? membersById.get(item.assigneeId) : undefined;
          const canToggle = isOwner || item.assigneeId === actor.id;
          return (
            <div className="list-row" key={item.id}>
              <form method="post" action={`/api/tasks/${task.id}/checklist/${item.id}/toggle`} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                <button
                  type="submit"
                  disabled={!canToggle}
                  className="button"
                  style={{ background: "none", padding: 0, border: "none", cursor: canToggle ? "pointer" : "default", color: item.done ? "var(--accent)" : "var(--muted)" }}
                  aria-label={item.done ? "Mark as not done" : "Mark as done"}
                >
                  {item.done ? "☑" : "☐"}
                </button>
                <span style={{ textDecoration: item.done ? "line-through" : "none", color: item.done ? "var(--muted)" : "var(--text)" }}>
                  {item.text}
                </span>
                {itemAssignee ? (
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    ({itemAssignee.name || itemAssignee.email})
                  </span>
                ) : null}
              </form>
              {isOwner ? (
                <form method="post" action={`/api/tasks/${task.id}/checklist/${item.id}/remove`}>
                  <button className="button button-danger" type="submit" style={{ fontSize: 12 }}>
                    Remove
                  </button>
                </form>
              ) : null}
            </div>
          );
        })}
        {task.checklist.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>
              No checklist items yet.
            </p>
          </div>
        ) : null}
      </div>
      {isOwner ? (
        <form method="post" action={`/api/tasks/${task.id}/checklist`} className="card" style={{ display: "flex", gap: 10, marginBottom: 28, maxWidth: 480 }}>
          <input type="text" name="text" placeholder="Add a checklist item" required style={{ flex: 1 }} />
          <button className="button" type="submit">
            Add
          </button>
        </form>
      ) : null}

      <h2>Attachments ({task.attachments.length})</h2>
      <div className="list" style={{ marginBottom: 20 }}>
        {task.attachments.map((attachment) => {
          const uploader = attachment.uploadedById ? membersById.get(attachment.uploadedById) : undefined;
          return (
            <div className="list-row" key={attachment.id}>
              <div className="main">
                <h3>
                  <a href={`/api/tasks/${task.id}/attachments/${attachment.id}`}>{attachment.filename}</a>
                </h3>
                <p className="muted">
                  {formatBytes(attachment.byteSize)}
                  {uploader ? ` · ${uploader.name || uploader.email}` : ""}
                  {" · "}
                  {new Date(attachment.createdAt).toLocaleDateString()}
                </p>
              </div>
              {isOwner ? (
                <form method="post" action={`/api/tasks/${task.id}/attachments/${attachment.id}/remove`}>
                  <button className="button button-danger" type="submit" style={{ fontSize: 12.5 }}>
                    Remove
                  </button>
                </form>
              ) : null}
            </div>
          );
        })}
        {task.attachments.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>
              No attachments yet.
            </p>
          </div>
        ) : null}
      </div>
      <form
        method="post"
        action={`/api/tasks/${task.id}/attachments`}
        encType="multipart/form-data"
        className="card"
        style={{ display: "flex", gap: 10, marginBottom: 28, maxWidth: 480, alignItems: "center" }}
      >
        <input type="file" name="file" required style={{ flex: 1 }} />
        <button className="button" type="submit">
          Upload
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

      <form method="post" action={`/api/tasks/${task.id}/comments`} className="card" style={{ display: "grid", gap: 10, maxWidth: 480, marginBottom: 28 }}>
        <label className="muted" htmlFor="body">
          Comment as {actor.email}
        </label>
        <textarea id="body" name="body" rows={3} required style={{ font: "inherit", padding: 8, borderRadius: 6, border: "1px solid var(--line)" }} />
        <button className="button" type="submit" style={{ justifySelf: "start" }}>
          Add comment
        </button>
      </form>

      <h2>Activity</h2>
      <div className="list">
        {activity.map((entry) => (
          <div className="list-row" key={entry.id} style={{ fontSize: 12.5 }}>
            <p className="muted" style={{ margin: 0 }}>
              <strong style={{ color: "var(--text)" }}>{entry.actorLabel}</strong> {activityVerb[entry.action] ?? entry.action}
              {entry.from && entry.to ? ` (${entry.from} → ${entry.to})` : entry.to ? `: ${entry.to}` : ""}
              {" · "}
              {new Date(entry.createdAt).toLocaleString()}
            </p>
          </div>
        ))}
        {activity.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>
              No activity yet.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
