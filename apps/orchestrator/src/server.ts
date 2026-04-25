import fastify from "fastify";
import cors from "@fastify/cors";
import jwtPlugin from "@fastify/jwt";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { db } from "./lib/db.js";
import { registerRoutes } from "./api/routes.js";
import { startCron } from "./cron.js";

async function main() {
  const app = fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(jwtPlugin, { secret: env().JWT_SECRET });

  app.setErrorHandler((err: any, _req, reply) => {
    logger.error({ err: err?.message, stack: err?.stack }, "request error");
    reply.status(err?.statusCode ?? 500).send({ error: err?.message ?? "internal_error" });
  });

  app.addHook("onRequest", async (req, _reply) => {
    logger.debug({ method: req.method, url: req.url }, "request");
  });

  app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  await registerRoutes(app, db);

  const port = env().PORT;
  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port }, "orchestrator http listening");

  // Cron + inbox poller run in-process alongside the HTTP server
  startCron(db());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
