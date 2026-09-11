import pino from "pino";

const logger = pino({ name: "igle-worker" });

logger.info(
  {
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379"
  },
  "Igle worker started."
);

setInterval(() => {
  logger.debug("worker heartbeat");
}, 30_000);
