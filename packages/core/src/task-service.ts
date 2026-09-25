import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertCan, IgleError, type Actor } from "@igle/shared";
import { buildNotification } from "./notification-service.js";
import { JsonStateStore, id } from "./state-store.js";
import type {
  NotificationKind,
  TaskActivityAction,
  TaskAttachment,
  TaskChecklistItem,
  TaskComment,
  TaskPriority,
  TaskRecord,
  TaskStatus,
  UserRecord
} from "./types.js";

export interface CreateTaskInput {
  siteId?: string | undefined;
  title: string;
  description: string;
  priority: TaskPriority;
  deadline?: string | undefined;
  assigneeId?: string | undefined;
}

export interface UpdateTaskInput {
  status?: TaskStatus | undefined;
  priority?: TaskPriority | undefined;
  deadline?: string | null | undefined;
  assigneeId?: string | null | undefined;
}

export interface AttachmentUploadInput {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

const maxAttachmentBytes = 20 * 1024 * 1024;

function userLabel(users: UserRecord[], userId: string | undefined, fallback = "Unassigned"): string {
  if (!userId) return fallback;
  const user = users.find((item) => item.id === userId);
  return user?.name || user?.email || fallback;
}

/** The set of people allowed to edit a task's fields/status/assignee, remove a checklist item or attachment, or reassign it — the assignee, the creator, or any administrator. Purely per-record; not expressible via the coarse role-only capability table. */
function isTaskOwner(task: TaskRecord, actor: Actor): boolean {
  return actor.role === "administrator" || task.assigneeId === actor.id || task.creatorId === actor.id;
}

function assertTaskOwner(task: TaskRecord, actor: Actor, action: string): void {
  if (!isTaskOwner(task, actor)) {
    throw new IgleError("FORBIDDEN", `Only the assignee, creator, or an administrator can ${action}.`, 403);
  }
}

function pushActivity(task: TaskRecord, entry: { action: TaskActivityAction; actorId?: string; actorLabel: string; from?: string; to?: string }): void {
  task.activity.push({ id: id("activity"), createdAt: new Date().toISOString(), ...entry });
}

export interface TaskPing {
  userId: string;
  taskId: string;
  message: string;
}

/** A side channel for task notifications beyond the in-app record (Telegram today) — structural, not a hard dependency: TaskService never imports the concrete implementation. */
export interface TaskPingDelivery {
  deliver(pings: TaskPing[]): Promise<void>;
}

export class TaskService {
  constructor(
    private readonly dataDir: string,
    private readonly stateStore: JsonStateStore,
    private readonly pingDelivery?: TaskPingDelivery
  ) {}

  /** Open to any signed-in user — task creation isn't ownership-gated, matching how the rest of this app treats team-wide work as shared/visible. */
  async create(input: CreateTaskInput, actor: Actor): Promise<TaskRecord> {
    const title = input.title.trim();
    if (!title) throw new IgleError("INVALID_TASK", "Title is required.", 400);
    const pings: TaskPing[] = [];
    const task = await this.stateStore.update((state) => {
      if (input.assigneeId && !state.users.some((user) => user.id === input.assigneeId)) {
        throw new IgleError("ASSIGNEE_NOT_FOUND", "That team member was not found.", 400);
      }
      const now = new Date().toISOString();
      const label = userLabel(state.users, actor.id, actor.email);
      const task: TaskRecord = {
        id: id("task"),
        siteId: input.siteId,
        title,
        description: input.description.trim(),
        priority: input.priority,
        status: "open",
        deadline: input.deadline,
        assigneeId: input.assigneeId,
        creatorId: actor.id,
        comments: [],
        checklist: [],
        attachments: [],
        activity: [],
        archivedAt: undefined,
        createdAt: now,
        updatedAt: now
      };
      pushActivity(task, { action: "created", actorId: actor.id, actorLabel: label });
      state.tasks.push(task);
      if (input.assigneeId && input.assigneeId !== actor.id) {
        const message = `${label} assigned you "${task.title}"`;
        state.notifications.push(buildNotification({ userId: input.assigneeId, kind: "task-assigned", taskId: task.id, message }));
        pings.push({ userId: input.assigneeId, taskId: task.id, message });
      }
      return task;
    });
    void this.pingDelivery?.deliver(pings).catch(() => undefined);
    return task;
  }

  /** Team-wide transparency — every signed-in user sees every task, same as the old Tickets list. */
  async list(includeArchived = false): Promise<TaskRecord[]> {
    const state = await this.stateStore.read();
    return includeArchived ? state.tasks : state.tasks.filter((task) => !task.archivedAt);
  }

  async listArchived(actor: Actor): Promise<TaskRecord[]> {
    assertCan(actor, "tasks.manage");
    const state = await this.stateStore.read();
    return state.tasks.filter((task) => task.archivedAt);
  }

  async get(taskId: string): Promise<TaskRecord | undefined> {
    const state = await this.stateStore.read();
    return state.tasks.find((task) => task.id === taskId);
  }

  async update(taskId: string, input: UpdateTaskInput, actor: Actor): Promise<TaskRecord> {
    const pings: TaskPing[] = [];
    const task = await this.stateStore.update((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new IgleError("TASK_NOT_FOUND", "Task was not found.", 404);
      assertTaskOwner(task, actor, "edit this task");

      const label = userLabel(state.users, actor.id, actor.email);

      if (input.status && input.status !== task.status) {
        pushActivity(task, { action: "status-changed", actorId: actor.id, actorLabel: label, from: task.status, to: input.status });
        task.status = input.status;
        const recipients = new Set(
          [task.assigneeId, task.creatorId].filter((userId): userId is string => Boolean(userId) && userId !== actor.id)
        );
        for (const recipientId of recipients) {
          const message = `${label} changed "${task.title}" to ${input.status}`;
          state.notifications.push(buildNotification({ userId: recipientId, kind: "task-status-changed" as NotificationKind, taskId: task.id, message }));
          pings.push({ userId: recipientId, taskId: task.id, message });
        }
      }
      if (input.priority && input.priority !== task.priority) {
        pushActivity(task, { action: "priority-changed", actorId: actor.id, actorLabel: label, from: task.priority, to: input.priority });
        task.priority = input.priority;
      }
      if (input.deadline !== undefined) {
        const nextDeadline = input.deadline ?? undefined;
        if (nextDeadline !== task.deadline) {
          pushActivity(task, { action: "deadline-changed", actorId: actor.id, actorLabel: label, from: task.deadline ?? "none", to: nextDeadline ?? "none" });
          task.deadline = nextDeadline;
        }
      }
      if (input.assigneeId !== undefined) {
        const nextAssigneeId = input.assigneeId ?? undefined;
        if (nextAssigneeId && !state.users.some((user) => user.id === nextAssigneeId)) {
          throw new IgleError("ASSIGNEE_NOT_FOUND", "That team member was not found.", 400);
        }
        if (nextAssigneeId !== task.assigneeId) {
          pushActivity(task, {
            action: "reassigned",
            actorId: actor.id,
            actorLabel: label,
            from: userLabel(state.users, task.assigneeId),
            to: userLabel(state.users, nextAssigneeId)
          });
          task.assigneeId = nextAssigneeId;
          if (nextAssigneeId && nextAssigneeId !== actor.id) {
            const message = `${label} assigned you "${task.title}"`;
            state.notifications.push(buildNotification({ userId: nextAssigneeId, kind: "task-assigned", taskId: task.id, message }));
            pings.push({ userId: nextAssigneeId, taskId: task.id, message });
          }
        }
      }

      task.updatedAt = new Date().toISOString();
      return task;
    });
    void this.pingDelivery?.deliver(pings).catch(() => undefined);
    return task;
  }

  /** Comments stay open to everyone signed in — collaboration, not editing the task's own fields. */
  async addComment(taskId: string, actor: Actor, body: string): Promise<TaskRecord> {
    const trimmed = body.trim();
    if (!trimmed) throw new IgleError("INVALID_COMMENT", "Comment cannot be empty.", 400);
    const pings: TaskPing[] = [];
    const task = await this.stateStore.update((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new IgleError("TASK_NOT_FOUND", "Task was not found.", 404);
      const label = userLabel(state.users, actor.id, actor.email);
      const comment: TaskComment = {
        id: id("comment"),
        author: label,
        authorId: actor.id,
        body: trimmed,
        createdAt: new Date().toISOString()
      };
      task.comments.push(comment);
      task.updatedAt = comment.createdAt;
      const recipients = new Set(
        [task.assigneeId, task.creatorId].filter((userId): userId is string => Boolean(userId) && userId !== actor.id)
      );
      for (const recipientId of recipients) {
        const message = `${label} commented on "${task.title}"`;
        state.notifications.push(buildNotification({ userId: recipientId, kind: "task-comment", taskId: task.id, message }));
        pings.push({ userId: recipientId, taskId: task.id, message });
      }
      return task;
    });
    void this.pingDelivery?.deliver(pings).catch(() => undefined);
    return task;
  }

  async archive(taskId: string, actor: Actor): Promise<TaskRecord> {
    assertCan(actor, "tasks.manage");
    return this.stateStore.update((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new IgleError("TASK_NOT_FOUND", "Task was not found.", 404);
      if (!task.archivedAt) {
        task.archivedAt = new Date().toISOString();
        pushActivity(task, { action: "archived", actorId: actor.id, actorLabel: userLabel(state.users, actor.id, actor.email) });
        task.updatedAt = task.archivedAt;
      }
      return task;
    });
  }

  async unarchive(taskId: string, actor: Actor): Promise<TaskRecord> {
    assertCan(actor, "tasks.manage");
    return this.stateStore.update((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new IgleError("TASK_NOT_FOUND", "Task was not found.", 404);
      if (task.archivedAt) {
        task.archivedAt = undefined;
        pushActivity(task, { action: "unarchived", actorId: actor.id, actorLabel: userLabel(state.users, actor.id, actor.email) });
        task.updatedAt = new Date().toISOString();
      }
      return task;
    });
  }

  /**
   * Archives every non-archived done/cancelled task right now — no day-of-week gating. Used by
   * both the admin's manual "Archive now" button and (indirectly) the weekly scheduled sweep
   * below. Not actor-gated at this layer since the worker calls it with no signed-in user at all;
   * callers that expose this to a human (the dashboard route) must check `tasks.manage` themselves.
   */
  async archiveCompletedAndCancelled(): Promise<{ archivedTaskIds: string[] }> {
    const archivedTaskIds: string[] = [];
    await this.stateStore.update((state) => {
      const now = new Date().toISOString();
      for (const task of state.tasks) {
        if (!task.archivedAt && (task.status === "done" || task.status === "cancelled")) {
          task.archivedAt = now;
          pushActivity(task, { action: "archived", actorLabel: "Weekly archive sweep" });
          task.updatedAt = now;
          archivedTaskIds.push(task.id);
        }
      }
    });
    return { archivedTaskIds };
  }

  /**
   * Called periodically by the worker (see apps/worker). The team's work week is Monday–Saturday,
   * so this only ever fires on Sunday — the one day outside it — and at most once per calendar
   * day, so a week's worth of completed/cancelled tasks is cleared out before the next work week
   * starts, without disrupting a live work day. `taskArchiveSweepAt` persists the last run date so
   * a worker restart later the same Sunday doesn't re-run, and a restart on any other day doesn't
   * either. Day-of-week/date comparisons use UTC, matching how dates are stored everywhere else in
   * this app (plain ISO strings, no per-team timezone concept yet).
   */
  async runWeeklyArchiveSweepIfDue(now: Date = new Date()): Promise<{ ran: boolean; archivedTaskIds: string[] }> {
    if (now.getUTCDay() !== 0) return { ran: false, archivedTaskIds: [] };
    const todayKey = now.toISOString().slice(0, 10);
    let due = false;
    await this.stateStore.update((state) => {
      if (state.taskArchiveSweepAt?.slice(0, 10) === todayKey) return;
      due = true;
      state.taskArchiveSweepAt = now.toISOString();
    });
    if (!due) return { ran: false, archivedTaskIds: [] };
    const { archivedTaskIds } = await this.archiveCompletedAndCancelled();
    return { ran: true, archivedTaskIds };
  }

  async addChecklistItem(taskId: string, actor: Actor, text: string): Promise<TaskRecord> {
    const trimmed = text.trim();
    if (!trimmed) throw new IgleError("VALIDATION_ERROR", "Checklist item text is required.", 400);
    return this.stateStore.update((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new IgleError("TASK_NOT_FOUND", "Task was not found.", 404);
      assertTaskOwner(task, actor, "add checklist items");
      const item: TaskChecklistItem = { id: id("checklist"), text: trimmed, done: false, createdAt: new Date().toISOString() };
      task.checklist.push(item);
      pushActivity(task, { action: "checklist-item-added", actorId: actor.id, actorLabel: userLabel(state.users, actor.id, actor.email), to: trimmed });
      task.updatedAt = item.createdAt;
      return task;
    });
  }

  /** Beyond the usual owner set, a checklist item's own assignee (if it has one) can toggle just that item — matches ClickUp letting a subtask's assignee check it off without owning the parent task. */
  async toggleChecklistItem(taskId: string, itemId: string, actor: Actor): Promise<TaskRecord> {
    return this.stateStore.update((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new IgleError("TASK_NOT_FOUND", "Task was not found.", 404);
      const item = task.checklist.find((entry) => entry.id === itemId);
      if (!item) throw new IgleError("CHECKLIST_ITEM_NOT_FOUND", "Checklist item was not found.", 404);
      if (!isTaskOwner(task, actor) && item.assigneeId !== actor.id) {
        throw new IgleError("FORBIDDEN", "Only the assignee, creator, an administrator, or this item's own assignee can toggle it.", 403);
      }
      item.done = !item.done;
      item.completedAt = item.done ? new Date().toISOString() : undefined;
      pushActivity(task, {
        action: "checklist-item-toggled",
        actorId: actor.id,
        actorLabel: userLabel(state.users, actor.id, actor.email),
        to: `${item.text}: ${item.done ? "done" : "not done"}`
      });
      task.updatedAt = new Date().toISOString();
      return task;
    });
  }

  async removeChecklistItem(taskId: string, itemId: string, actor: Actor): Promise<TaskRecord> {
    return this.stateStore.update((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new IgleError("TASK_NOT_FOUND", "Task was not found.", 404);
      assertTaskOwner(task, actor, "remove checklist items");
      const item = task.checklist.find((entry) => entry.id === itemId);
      if (!item) throw new IgleError("CHECKLIST_ITEM_NOT_FOUND", "Checklist item was not found.", 404);
      task.checklist = task.checklist.filter((entry) => entry.id !== itemId);
      pushActivity(task, { action: "checklist-item-removed", actorId: actor.id, actorLabel: userLabel(state.users, actor.id, actor.email), from: item.text });
      task.updatedAt = new Date().toISOString();
      return task;
    });
  }

  /** Open to anyone signed in, same as comments — an attachment is usually posted alongside one. Writes the file to disk first, then records it; a task that vanishes between the two (very unlikely — no delete exists, only archive) would leave one orphaned file, not a broken record. */
  async addAttachment(taskId: string, input: AttachmentUploadInput, actor: Actor): Promise<TaskRecord> {
    if (input.buffer.byteLength === 0) throw new IgleError("VALIDATION_ERROR", "The uploaded file is empty.", 400);
    if (input.buffer.byteLength > maxAttachmentBytes) throw new IgleError("FILE_TOO_LARGE", "Attachments must be 20MB or smaller.", 413);

    const safeName = path.basename(input.originalName).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "file";
    const filename = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}-${safeName}`;
    const relativePath = path.posix.join(taskId, filename);
    const destination = path.join(this.dataDir, "task-attachments", taskId, filename);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, input.buffer);

    return this.stateStore.update((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new IgleError("TASK_NOT_FOUND", "Task was not found.", 404);
      const attachment: TaskAttachment = {
        id: id("attachment"),
        filename: input.originalName.slice(0, 200) || safeName,
        mimeType: input.mimeType || "application/octet-stream",
        byteSize: input.buffer.byteLength,
        storageKey: relativePath,
        uploadedById: actor.id,
        createdAt: new Date().toISOString()
      };
      task.attachments.push(attachment);
      pushActivity(task, {
        action: "attachment-added",
        actorId: actor.id,
        actorLabel: userLabel(state.users, actor.id, actor.email),
        to: attachment.filename
      });
      task.updatedAt = attachment.createdAt;
      return task;
    });
  }

  /** Removal is ownership-gated (unlike adding one) — deletion is destructive and there's no "delete your own contribution" precedent elsewhere in this app. Removes the state record first, the file second, so a mid-failure leaves an orphaned file rather than a record pointing at nothing. */
  async removeAttachment(taskId: string, attachmentId: string, actor: Actor): Promise<TaskRecord> {
    const { task, storageKey } = await this.stateStore.update((state) => {
      const found = state.tasks.find((item) => item.id === taskId);
      if (!found) throw new IgleError("TASK_NOT_FOUND", "Task was not found.", 404);
      assertTaskOwner(found, actor, "remove attachments");
      const attachment = found.attachments.find((item) => item.id === attachmentId);
      if (!attachment) throw new IgleError("ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404);
      found.attachments = found.attachments.filter((item) => item.id !== attachmentId);
      pushActivity(found, {
        action: "attachment-removed",
        actorId: actor.id,
        actorLabel: userLabel(state.users, actor.id, actor.email),
        from: attachment.filename
      });
      found.updatedAt = new Date().toISOString();
      return { task: found, storageKey: attachment.storageKey };
    });
    await fs.rm(path.join(this.dataDir, "task-attachments", storageKey), { force: true }).catch(() => undefined);
    return task;
  }

  async getAttachment(taskId: string, attachmentId: string): Promise<{ attachment: TaskAttachment; absolutePath: string } | undefined> {
    const state = await this.stateStore.read();
    const task = state.tasks.find((item) => item.id === taskId);
    const attachment = task?.attachments.find((item) => item.id === attachmentId);
    if (!task || !attachment) return undefined;
    return { attachment, absolutePath: path.join(this.dataDir, "task-attachments", attachment.storageKey) };
  }
}
