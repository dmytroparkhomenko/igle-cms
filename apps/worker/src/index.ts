import path from "node:path";
import pino from "pino";
import { JsonStateStore, TaskService } from "@igle/core";

const logger = pino({ name: "igle-worker" });

logger.info(
  {
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379"
  },
  "Igle worker started."
);

const dataDir = process.env.IGLE_DATA_DIR ?? path.resolve(process.cwd(), "../../data");
const stateStore = new JsonStateStore(dataDir);
const taskService = new TaskService(dataDir, stateStore);

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

setInterval(() => {
  logger.debug("worker heartbeat");
}, 30_000);
