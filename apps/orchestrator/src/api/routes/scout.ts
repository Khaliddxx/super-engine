import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { desc, eq, gt, type DbClient, campaigns, marketScans } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import {
  runMarketScout,
  CITY_SETS,
  NICHE_TICKET_WEIGHTS,
  SUPPORTED_COUNTRIES,
  normalizeCountry,
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

function asCountry(input: string | undefined): string | null {
  try {
    return normalizeCountry(input ?? "US");
  } catch {
    return null;
  }
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

  // Dynamic facets for the workbench (recent scan signals + active campaigns),
  // so the UI is not forced into hardcoded lists.
  app.get<{ Querystring: { country?: string } }>("/facets", async (req) => {
    const db = opts.db();
    const country = asCountry(req.query.country) ?? "US";
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [scanRows, activeCampaigns] = await Promise.all([
      db
        .select({
          niche: marketScans.niche,
          city: marketScans.city,
          opportunityScore: marketScans.opportunityScore,
          pctOutdatedEstimate: marketScans.pctOutdatedEstimate,
          createdAt: marketScans.createdAt,
        })
        .from(marketScans)
        .where(gt(marketScans.createdAt, cutoff))
        .orderBy(desc(marketScans.createdAt))
        .limit(500),
      db
        .select({
          niche: campaigns.niche,
          city: campaigns.targetCity,
          country: campaigns.targetCountry,
          createdAt: campaigns.createdAt,
        })
        .from(campaigns)
        .where(eq(campaigns.status, "active"))
        .orderBy(desc(campaigns.createdAt))
        .limit(300),
    ]);

    const byCountry = scanRows.filter((r) => {
      const cityInCountry = (CITY_SETS[country] ?? []).includes(r.city);
      return cityInCountry;
    });
    const nicheMap = new Map<string, { samples: number; avgScore: number; avgNeed: number }>();
    for (const r of byCountry) {
      const key = r.niche.toLowerCase();
      const old = nicheMap.get(key) ?? { samples: 0, avgScore: 0, avgNeed: 0 };
      const n = old.samples + 1;
      const score = r.opportunityScore ? Number(r.opportunityScore) : 0;
      const need = r.pctOutdatedEstimate ? Number(r.pctOutdatedEstimate) : 0;
      nicheMap.set(key, {
        samples: n,
        avgScore: (old.avgScore * old.samples + score) / n,
        avgNeed: (old.avgNeed * old.samples + need) / n,
      });
    }

    const suggestedNiches = [...nicheMap.entries()]
      .map(([niche, v]) => ({
        niche,
        samples: v.samples,
        avgScore: Math.round(v.avgScore * 10) / 10,
        avgNeed: Math.round(v.avgNeed * 100) / 100,
      }))
      .sort((a, b) => b.avgScore - a.avgScore || b.samples - a.samples)
      .slice(0, 40);

    const suggestedCities = [...new Set((CITY_SETS[country] ?? []).filter((c) => byCountry.some((r) => r.city === c)))]
      .slice(0, 60);

    const activeMarkets = activeCampaigns
      .filter((c) => (c.country ?? "").toUpperCase() === country && c.city)
      .map((c) => ({
        niche: c.niche,
        city: c.city!,
        createdAt: c.createdAt,
      }));

    return {
      country,
      suggestedNiches,
      suggestedCities,
      activeMarkets,
      countries: SUPPORTED_COUNTRIES,
    };
  });

  app.get<{ Querystring: { country?: string; limit?: string; diversify?: string } }>("/", async (req, reply) => {
    const db = opts.db();
    const country = asCountry(req.query.country);
    if (!country) return reply.status(400).send({ error: "unsupported_country", supported: SUPPORTED_COUNTRIES });
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

  app.post<{ Body: { country?: string; maxCells?: number; niches?: string[]; cities?: string[] } }>("/run", async (req, reply) => {
    const db = opts.db();
    const country = asCountry(req.body?.country);
    if (!country) return reply.status(400).send({ error: "unsupported_country", supported: SUPPORTED_COUNTRIES });
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
        const country = asCountry(req.body?.country);
        if (!country) return reply.status(400).send({ error: "unsupported_country", supported: SUPPORTED_COUNTRIES });
        const result = await pickAndLaunch(db, {
          country,
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
        const country = asCountry(req.body?.country);
        if (!country) return reply.status(400).send({ error: "unsupported_country", supported: SUPPORTED_COUNTRIES });
        if (!req.body?.niche || !req.body?.city) {
          return reply.status(400).send({ error: "niche and city are required" });
        }
        const result = await pickAndLaunchCustom(db, {
          niche: req.body.niche,
          city: req.body.city,
          country,
          maxProspects: req.body.maxProspects ?? 25,
        });
        return result;
      } catch (err) {
        return reply.status(500).send({ error: String((err as Error).message) });
      }
    },
  );
}
