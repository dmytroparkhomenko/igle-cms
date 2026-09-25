import type { Actor } from "@igle/shared";
import { JsonStateStore, id } from "./state-store.js";
import type { NotificationKind, NotificationRecord } from "./types.js";

/**
 * A pure record builder — deliberately not a method on NotificationService. TaskService pushes
 * the result of this directly into `state.notifications` from inside its own `stateStore.update()`
 * transaction, rather than calling into a second service's mutating method, since two separate
 * read-modify-write round trips against the same single JSON file would risk a lost update between
 * them. Every other mutation in this codebase already follows the "one service owns one
 * stateStore.update() call per action" shape; this keeps notifications consistent with that.
 */
export function buildNotification(input: { userId: string; kind: NotificationKind; taskId: string; message: string }): NotificationRecord {
  return {
    id: id("notif"),
    userId: input.userId,
    kind: input.kind,
    taskId: input.taskId,
    message: input.message,
    createdAt: new Date().toISOString()
  };
}

export class NotificationService {
  constructor(private readonly stateStore: JsonStateStore) {}

  async listForUser(actor: Actor, limit = 50): Promise<NotificationRecord[]> {
    const state = await this.stateStore.read();
    return state.notifications
      .filter((notification) => notification.userId === actor.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async unreadCount(actor: Actor): Promise<number> {
    const state = await this.stateStore.read();
    return state.notifications.filter((notification) => notification.userId === actor.id && !notification.readAt).length;
  }

  async markRead(notificationId: string, actor: Actor): Promise<void> {
    await this.stateStore.update((state) => {
      const notification = state.notifications.find((item) => item.id === notificationId && item.userId === actor.id);
      if (notification && !notification.readAt) notification.readAt = new Date().toISOString();
    });
  }

  async markAllRead(actor: Actor): Promise<void> {
    await this.stateStore.update((state) => {
      const now = new Date().toISOString();
      for (const notification of state.notifications) {
        if (notification.userId === actor.id && !notification.readAt) notification.readAt = now;
      }
    });
  }

  /** Called when the actor views the task a notification points at — e.g. following a Telegram link straight to `/tasks/:id` skips the notifications page entirely, so without this the unread badge would never clear for that path. A cheap read first avoids taking the write lock on every task view when there's nothing to mark. */
  async markReadForTask(actor: Actor, taskId: string): Promise<void> {
    const state = await this.stateStore.read();
    const hasUnread = state.notifications.some(
      (notification) => notification.userId === actor.id && notification.taskId === taskId && !notification.readAt
    );
    if (!hasUnread) return;
    await this.stateStore.update((state) => {
      const now = new Date().toISOString();
      for (const notification of state.notifications) {
        if (notification.userId === actor.id && notification.taskId === taskId && !notification.readAt) {
          notification.readAt = now;
        }
      }
    });
  }
}
