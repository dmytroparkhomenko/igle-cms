import path from "node:path";
import pino from "pino";
import { ImportService, JsonStateStore, RemoteSiteImportService, RevisionService, SiteService, TaskService, TelegramNotifier } from "@igle/core";

const logger = pino({ name: "igle-worker" });

logger.info(
  {
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379"
  },
  "Igle worker started."
);

const dataDir = process.env.IGLE_DATA_DIR ?? path.resolve(process.cwd(), "../../data");
const stateStore = new JsonStateStore(dataDir);
const telegramNotifier = new TelegramNotifier(stateStore, process.env.WEB_ORIGIN ?? "http://localhost:3000");
const taskService = new TaskService(dataDir, stateStore, telegramNotifier);
const revisionService = new RevisionService(stateStore);
const siteService = new SiteService(dataDir, stateStore, revisionService);
const importService = new ImportService(stateStore, revisionService);
const remoteSiteImportService = new RemoteSiteImportService(stateStore, siteService, importService);

// Hourly is plenty of resolution for a check that only ever fires once, on Sundays — this just
// makes sure a worker restart earlier in the day still catches it promptly rather than waiting.
const ARCHIVE_SWEEP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

async function checkWeeklyTaskArchiveSweep(): Promise<void> {
  try {
    const result = await taskService.runWeeklyArchiveSweepIfDue();
    if (result.ran) {
      logger.info({ archivedCount: result.archivedTaskIds.length, taskIds: result.archivedTaskIds }, "Weekly task archive sweep ran.");
    }
  } catch (error) {
    logger.error({ error }, "Weekly task archive sweep failed.");
  }
}

void checkWeeklyTaskArchiveSweep();
setInterval(() => {
  void checkWeeklyTaskArchiveSweep();
}, ARCHIVE_SWEEP_CHECK_INTERVAL_MS);

// Same "once per day, but check hourly so a restart doesn't miss the window" shape as the weekly
// archive sweep — checkDeadlineRemindersIfDue self-gates to once per UTC calendar day.
const DEADLINE_REMINDER_CHECK_INTERVAL_MS = 60 * 60 * 1000;

async function checkTaskDeadlineReminders(): Promise<void> {
  try {
    const result = await taskService.checkDeadlineRemindersIfDue();
    if (result.ran) {
      logger.info("Task deadline reminder sweep ran.");
    }
  } catch (error) {
    logger.error({ error }, "Task deadline reminder sweep failed.");
  }
}

void checkTaskDeadlineReminders();
setInterval(() => {
  void checkTaskDeadlineReminders();
}, DEADLINE_REMINDER_CHECK_INTERVAL_MS);

// Short interval so "connect a server → its sites show up automatically" actually feels
// immediate — a full import can still take a while per server, but this makes sure it starts
// within seconds of the server being added rather than waiting on the next hourly tick.
const AAPANEL_IMPORT_CHECK_INTERVAL_MS = 15 * 1000;

async function checkPendingAaPanelImports(): Promise<void> {
  try {
    await remoteSiteImportService.processPendingImports(
      (progress) => {
        logger.info(progress, "aaPanel site import progress.");
      },
      (outcome) => {
        if (outcome.status === "failed") logger.error(outcome, "aaPanel site import failed for one domain.");
        else logger.info(outcome, "aaPanel site import result.");
      }
    );
  } catch (error) {
    logger.error({ error }, "aaPanel site import sweep failed.");
  }
}

void checkPendingAaPanelImports();
setInterval(() => {
  void checkPendingAaPanelImports();
}, AAPANEL_IMPORT_CHECK_INTERVAL_MS);

setInterval(() => {
  logger.debug("worker heartbeat");
}, 30_000);
