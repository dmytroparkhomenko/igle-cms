import Link from "next/link";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const actor = await requireActorOrRedirect();
  const notifications = await runtime.notificationService.listForUser(actor);
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Notifications</h1>
          <p className="muted">{unreadCount} unread.</p>
        </div>
        {unreadCount > 0 ? (
          <form method="post" action="/api/notifications/read-all">
            <button className="button" type="submit" style={{ background: "none", color: "var(--accent)" }}>
              Mark all read
            </button>
          </form>
        ) : null}
      </div>

      <div className="list">
        {notifications.map((notification) => (
          <div className="list-row" key={notification.id} style={notification.readAt ? undefined : { borderColor: "var(--accent)" }}>
            <div className="main">
              <h3 style={{ fontWeight: notification.readAt ? 400 : 600 }}>
                <Link href={`/tasks/${notification.taskId}`}>{notification.message}</Link>
              </h3>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                {new Date(notification.createdAt).toLocaleString()}
              </p>
            </div>
            {!notification.readAt ? (
              <form method="post" action={`/api/notifications/${notification.id}/read`}>
                <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", fontSize: 12 }}>
                  Mark read
                </button>
              </form>
            ) : null}
          </div>
        ))}
        {notifications.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>
              No notifications yet — you'll see one here when someone assigns or comments on a task.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
