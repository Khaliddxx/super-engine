import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { type DbClient } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import { runMarketScout } from "../../modules/market-scout.js";
import { diversifyByNiche, getFreshScoutRows, pickAndLaunch } from "../../modules/market-launch.js";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function scoutRoutes(app: FastifyInstance, opts: Opts): Promise<void> {
  app.addHook("onRequest", requireAuth);

  app.get<{ Querystring: { country?: string; limit?: string; diversify?: string } }>("/", async (req) => {
    const db = opts.db();
    const country = (req.query.country ?? "AU").toUpperCase();
    const limit = Math.min(Number(req.query.limit ?? 10) || 10, 50);
    const diversify = req.query.diversify !== "false";
    const { rows, totalCells, cacheHit } = await getFreshScoutRows(db, country);
    const displayed = diversify ? diversifyByNiche(rows, 2) : rows;

    const nicheSet = new Set(rows.map((r) => r.niche));
    const citySet = new Set(rows.map((r) => r.city));

    return {
      country,
      items: displayed.slice(0, limit),
      meta: {
        totalOpportunities: totalCells,
        nichesScanned: nicheSet.size,
        citiesScanned: citySet.size,
        cacheHit,
        note: "businessCount is capped at 20 by Google Places textSearch. Opportunity score uses median review count, not sum, so corporate chains don't dominate.",
      },
    };
  });

  app.post<{ Body: { country?: string; maxCells?: number } }>("/run", async (req) => {
    const db = opts.db();
    const country = (req.body?.country ?? "AU").toUpperCase();
    const rows = await runMarketScout(db, { country, maxCells: req.body?.maxCells });
    const diversified = diversifyByNiche(rows, 2);
    return { items: diversified.slice(0, 20), total: rows.length };
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
