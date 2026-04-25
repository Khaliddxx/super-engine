import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { type DbClient } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import { runMarketScout } from "../../modules/market-scout.js";
import { getFreshScoutRows, pickAndLaunch } from "../../modules/market-launch.js";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function scoutRoutes(app: FastifyInstance, opts: Opts): Promise<void> {
  app.addHook("onRequest", requireAuth);

  app.get<{ Querystring: { country?: string; limit?: string } }>("/", async (req) => {
    const db = opts.db();
    const country = (req.query.country ?? "AU").toUpperCase();
    const limit = Math.min(Number(req.query.limit ?? 10) || 10, 30);
    const rows = await getFreshScoutRows(db, country);
    return { country, items: rows.slice(0, limit) };
  });

  app.post<{ Body: { country?: string; maxCells?: number } }>("/run", async (req) => {
    const db = opts.db();
    const country = (req.body?.country ?? "AU").toUpperCase();
    const rows = await runMarketScout(db, { country, maxCells: req.body?.maxCells ?? 30 });
    return { items: rows.slice(0, 20) };
  });

  app.post<{ Body: { country?: string; rank?: number; maxProspects?: number } }>(
    "/pick-and-launch",
    async (req, reply) => {
      const db = opts.db();
      try {
        const result = await pickAndLaunch(db, {
          country: req.body?.country,
          rank: req.body?.rank,
          maxProspects: req.body?.maxProspects,
        });
        return {
          campaign: result.campaign,
          pick: result.pick,
          summary: result.summary,
        };
      } catch (err) {
        return reply.status(500).send({ error: String((err as Error).message) });
      }
    },
  );
}
