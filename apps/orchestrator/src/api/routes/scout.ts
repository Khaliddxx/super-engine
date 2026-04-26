import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { type DbClient } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import {
  runMarketScout,
  CITY_SETS,
  NICHE_TICKET_WEIGHTS,
  SUPPORTED_COUNTRIES,
} from "../../modules/market-scout.js";
import {
  diversifyByNiche,
  getFreshScoutRows,
  pickAndLaunch,
  pickAndLaunchCustom,
} from "../../modules/market-launch.js";
import { triggerAutoScoutNow } from "../../cron.js";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function scoutRoutes(app: FastifyInstance, opts: Opts): Promise<void> {
  app.addHook("onRequest", requireAuth);

  // Expose the FULL catalog of niches and countries/cities the scout knows
  // about, so the PWA can render a real picker instead of a 4-country toggle.
  app.get("/catalog", async () => {
    const niches = Object.entries(NICHE_TICKET_WEIGHTS)
      .map(([niche, weight]) => ({ niche, weight }))
      .sort((a, b) => b.weight - a.weight || a.niche.localeCompare(b.niche));
    const countries = SUPPORTED_COUNTRIES.map((c) => ({
      country: c,
      cities: CITY_SETS[c] ?? [],
    }));
    return { niches, countries };
  });

  app.get<{ Querystring: { country?: string; limit?: string; diversify?: string } }>("/", async (req) => {
    const db = opts.db();
    const country = (req.query.country ?? "AU").toUpperCase();
    const limit = Math.min(Number(req.query.limit ?? 12) || 12, 50);
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
        note: "Opportunity score factors in niche ticket size, median review volume, and pct of businesses with websites. Outdated-site filtering happens at scrape time, not here.",
      },
    };
  });

  app.post<{ Body: { country?: string; maxCells?: number; niches?: string[]; cities?: string[] } }>("/run", async (req) => {
    const db = opts.db();
    const country = (req.body?.country ?? "AU").toUpperCase();
    const rows = await runMarketScout(db, {
      country,
      maxCells: req.body?.maxCells,
      niches: req.body?.niches,
      cities: req.body?.cities,
    });
    const diversified = diversifyByNiche(rows, 2);
    return { items: diversified.slice(0, 30), total: rows.length };
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

  // Manually trigger the daily auto-scout (which normally runs at 09:00 UTC).
  // Walks all active campaigns and re-runs Places scrape, top-5 quietest first.
  app.post("/auto-run-now", async (req, reply) => {
    const db = opts.db();
    try {
      const result = await triggerAutoScoutNow(db);
      return result;
    } catch (err) {
      return reply.status(500).send({ error: String((err as Error).message) });
    }
  });

  // Custom launch — the operator picks niche + city directly. No ranking
  // dependency; the scrape's outdated-site filter still applies.
  app.post<{ Body: { niche?: string; city?: string; country?: string; maxProspects?: number } }>(
    "/launch-custom",
    async (req, reply) => {
      const db = opts.db();
      try {
        if (!req.body?.niche || !req.body?.city) {
          return reply.status(400).send({ error: "niche and city are required" });
        }
        const result = await pickAndLaunchCustom(db, {
          niche: req.body.niche,
          city: req.body.city,
          country: req.body.country ?? "AU",
          maxProspects: req.body.maxProspects ?? 25,
        });
        return result;
      } catch (err) {
        return reply.status(500).send({ error: String((err as Error).message) });
      }
    },
  );
}
