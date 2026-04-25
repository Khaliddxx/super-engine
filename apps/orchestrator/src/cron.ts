import cron from "node-cron";
import { type DbClient } from "@super-engine/db";
import { runPipelineCycle, runAutoSendPass } from "./modules/scheduler.js";
import { pollLinkedInInbox } from "./modules/inbox.js";
import { logger } from "./lib/logger.js";

let running = { pipeline: false, inbox: false };

export function startCron(db: DbClient): void {
  // Pipeline cycle every 3 minutes
  cron.schedule("*/3 * * * *", async () => {
    if (running.pipeline) return;
    running.pipeline = true;
    try {
      const counts = await runPipelineCycle(db);
      if (Object.values(counts).some((c) => c > 0)) logger.info({ counts }, "pipeline cycle");
      const sent = await runAutoSendPass(db);
      if (sent > 0) logger.info({ sent }, "auto-send pass");
    } catch (err) {
      logger.error({ err: String(err) }, "pipeline cycle failed");
    } finally {
      running.pipeline = false;
    }
  });

  // LinkedIn inbox polling every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    if (running.inbox) return;
    running.inbox = true;
    try {
      const result = await pollLinkedInInbox(db);
      if (result.acceptedCount || result.newMessages) logger.info(result, "linkedin inbox poll");
    } catch (err) {
      logger.error({ err: String(err) }, "inbox poll failed");
    } finally {
      running.inbox = false;
    }
  });

  logger.info("cron scheduler started");
}
