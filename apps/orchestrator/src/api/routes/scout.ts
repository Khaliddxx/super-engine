import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { desc, eq, type DbClient, marketScans } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import { runMarketScout } from "../../modules/market-scout.js";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function scoutRoutes(app: FastifyInstance, opts: Opts): Promise<void> {
  app.addHook("onRequest", requireAuth);

  app.get("/", async () => {
    const db = opts.db();
    const rows = await db.select().from(marketScans).orderBy(desc(marketScans.opportunityScore)).limit(30);
    return { items: rows };
  });

  app.post<{ Body: { country?: string; maxCells?: number } }>("/run", async (req) => {
    const db = opts.db();
    const country = (req.body?.country ?? "AU").toUpperCase();
    const rows = await runMarketScout(db, { country, maxCells: req.body?.maxCells ?? 30 });
    return { items: rows.slice(0, 20) };
  });
}
