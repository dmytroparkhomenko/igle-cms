import Link from "next/link";
import { IgleError } from "@igle/shared";
import { runtime } from "../../../lib/runtime";
import { requireActorOrRedirect } from "../../../lib/session";

export const dynamic = "force-dynamic";

export default async function TaskArchivePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requireActorOrRedirect();
  const { error } = await searchParams;

  let tasks: Awaited<ReturnType<typeof runtime.taskService.listArchived>> = [];
  let forbidden = false;
  try {
    tasks = await runtime.taskService.listArchived(actor);
  } catch (err) {
    if (err instanceof IgleError && err.code === "FORBIDDEN") forbidden = true;
    else throw err;
  }

  if (forbidden) {
    return (
      <>
        <div className="toolbar">
          <h1>Task archive</h1>
        </div>
        <article className="card">
          <p className="muted" style={{ margin: 0 }}>Only administrators can view the archive.</p>
        </article>
      </>
    );
  }

  const members = await runtime.authService.listSelectable(actor);
  const membersById = new Map(members.map((member) => [member.id, member]));

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Task archive</h1>
          <p className="muted">{tasks.length} archived.</p>
        </div>
        <Link href="/tasks" className="button" style={{ background: "none", color: "var(--accent)" }}>
          Back to tasks
        </Link>
      </div>

      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {error}
        </article>
      ) : null}

      <div className="list">
        {tasks.map((task) => {
          const assignee = task.assigneeId ? membersById.get(task.assigneeId) : undefined;
          return (
            <div className="list-row" key={task.id}>
              <div className="main">
                <h3>
                  <Link href={`/tasks/${task.id}`}>{task.title}</Link>
                </h3>
                <p className="muted">{assignee ? assignee.name || assignee.email : "Unassigned"}</p>
              </div>
              <form method="post" action={`/api/tasks/${task.id}/unarchive`}>
                <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", fontSize: 12.5 }}>
                  Restore
                </button>
              </form>
            </div>
          );
        })}
        {tasks.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>
              Nothing archived.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
