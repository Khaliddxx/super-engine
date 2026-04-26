import fastify from "fastify";
import cors from "@fastify/cors";
import jwtPlugin from "@fastify/jwt";
import { sql as rawSql } from "@super-engine/db";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { db } from "./lib/db.js";
import { registerRoutes } from "./api/routes.js";
import { startCron } from "./cron.js";

/**
 * Run additive schema migrations on boot. Everything uses IF NOT EXISTS so
 * it is idempotent and safe to run on every start. We intentionally keep
 * this minimal (no Drizzle migrator machinery) — the goal is just to make
 * sure new columns exist before application code references them.
 */
async function runStartupMigrations(): Promise<void> {
  try {
    const d = db();
    await d.execute(rawSql`ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "scraped_assets" jsonb`);
    await d.execute(rawSql`ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "scraped_sitemap" jsonb`);
    await d.execute(rawSql`ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "site_strength_score" numeric(4, 1)`);
    await d.execute(rawSql`ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "site_strength_signals" jsonb`);
    await d.execute(rawSql`ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "redesign_instruction" text`);
    await d.execute(rawSql`ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "contact_first_name" text`);
    await d.execute(rawSql`ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "contact_last_name" text`);
    await d.execute(rawSql`ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "contact_title" text`);
    await d.execute(rawSql`ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "contact_email_confidence" integer`);
    await d.execute(rawSql`ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "contact_email_type" text`);
    await d.execute(rawSql`ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "contact_source" text`);
    await d.execute(rawSql`ALTER TABLE "market_scans" ADD COLUMN IF NOT EXISTS "outcome_score" numeric(4, 3)`);
    await d.execute(rawSql`ALTER TABLE "market_scans" ADD COLUMN IF NOT EXISTS "source" varchar(24) DEFAULT 'scout'`);
    await d.execute(rawSql`ALTER TABLE "operator_settings" ADD COLUMN IF NOT EXISTS "preferences" jsonb`);
    await d.execute(
      rawSql`UPDATE "campaigns" SET "outreach_channel" = 'both' WHERE "outreach_channel" = 'linkedin' AND "created_at" > NOW() - INTERVAL '60 days'`,
    );
    logger.info("startup migrations applied");
  } catch (err) {
    logger.error({ err: String(err) }, "startup migrations failed");
  }
}

async function main() {
  await runStartupMigrations();

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
