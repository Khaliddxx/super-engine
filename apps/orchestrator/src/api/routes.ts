import type { FastifyInstance } from "fastify";
import { type DbClient } from "@super-engine/db";
import { authRoutes } from "./routes/auth.js";
import { queueRoutes } from "./routes/queue.js";
import { pipelineRoutes } from "./routes/pipeline.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { promptRoutes } from "./routes/prompts.js";
import { settingsRoutes } from "./routes/settings.js";
import { scoutRoutes } from "./routes/scout.js";

export async function registerRoutes(app: FastifyInstance, db: () => DbClient): Promise<void> {
  await app.register(authRoutes, { prefix: "/api/auth", db });
  await app.register(queueRoutes, { prefix: "/api/queue", db });
  await app.register(pipelineRoutes, { prefix: "/api/pipeline", db });
  await app.register(campaignRoutes, { prefix: "/api/campaigns", db });
  await app.register(dashboardRoutes, { prefix: "/api/dashboard", db });
  await app.register(promptRoutes, { prefix: "/api/prompts", db });
  await app.register(settingsRoutes, { prefix: "/api/settings", db });
  await app.register(scoutRoutes, { prefix: "/api/scout", db });
}
