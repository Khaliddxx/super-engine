import { marketScans, type DbClient } from "@super-engine/db";
import { textSearch } from "../integrations/places.js";
import { logger } from "../lib/logger.js";
import crypto from "node:crypto";

const NICHE_TICKET_WEIGHTS: Record<string, number> = {
  "wedding venue": 2.0,
  "hotel": 2.0,
  "dentist": 1.5,
  "med spa": 1.5,
  "law firm": 1.5,
  "plumber": 1.2,
  "hvac": 1.2,
  "electrician": 1.2,
  "restaurant": 0.8,
  "cafe": 0.8,
  "nail salon": 0.7,
  "hair salon": 0.7,
  "barber shop": 0.7,
  "yoga studio": 1.0,
  "personal trainer": 1.0,
};

const CITY_SETS: Record<string, string[]> = {
  AU: [
    "Sydney",
    "Melbourne",
    "Brisbane",
    "Perth",
    "Adelaide",
    "Gold Coast",
    "Newcastle",
    "Canberra",
    "Hobart",
    "Geelong",
  ],
  US: ["Austin", "Denver", "Portland", "Nashville", "Raleigh", "Charlotte"],
  UK: ["Bristol", "Manchester", "Leeds", "Edinburgh", "Cardiff"],
  NL: ["Amsterdam", "Rotterdam", "Utrecht", "The Hague", "Eindhoven"],
};

export interface ScoutOptions {
  country: string;
  maxCells?: number;
  niches?: string[];
}

export interface ScoutRow {
  niche: string;
  city: string;
  businessCount: number;
  avgRating: number;
  totalReviews: number;
  pctWithWebsite: number;
  opportunityScore: number;
  nicheTicketWeight: number;
}

export async function runMarketScout(db: DbClient, opts: ScoutOptions): Promise<ScoutRow[]> {
  const scanRunId = crypto.randomUUID();
  const country = opts.country.toUpperCase();
  const cities = CITY_SETS[country] ?? CITY_SETS.AU!;
  const niches = opts.niches ?? Object.keys(NICHE_TICKET_WEIGHTS);
  const maxCells = opts.maxCells ?? 50;

  const cells: Array<{ niche: string; city: string }> = [];
  for (const niche of niches) {
    for (const city of cities) cells.push({ niche, city });
    if (cells.length >= maxCells) break;
  }
  const trimmed = cells.slice(0, maxCells);

  const results: ScoutRow[] = [];
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  for (const cell of trimmed) {
    try {
      const query = `${cell.niche} in ${cell.city}`;
      const places = await textSearch(query, { max: 20 });
      const withWebsite = places.filter((p) => p.website).length;
      const totalReviews = places.reduce((s, p) => s + (p.userRatingCount ?? 0), 0);
      const rated = places.filter((p) => p.rating !== null);
      const avgRating = rated.length ? rated.reduce((s, p) => s + (p.rating ?? 0), 0) / rated.length : 0;
      const pctWithWebsite = places.length ? withWebsite / places.length : 0;
      const pctOutdatedEstimate = 0.6; // heuristic; full Lighthouse scoring skipped per scope
      const tw = NICHE_TICKET_WEIGHTS[cell.niche] ?? 1.0;
      const opportunityScore =
        Math.log(Math.max(places.length, 1)) *
        pctOutdatedEstimate *
        Math.max(Math.log(totalReviews + 1), 1) *
        tw;

      const row: ScoutRow = {
        niche: cell.niche,
        city: cell.city,
        businessCount: places.length,
        avgRating: Math.round(avgRating * 10) / 10,
        totalReviews,
        pctWithWebsite: Math.round(pctWithWebsite * 100) / 100,
        opportunityScore: Math.round(opportunityScore * 100) / 100,
        nicheTicketWeight: tw,
      };
      results.push(row);

      await db.insert(marketScans).values({
        scanRunId,
        country,
        niche: row.niche,
        city: row.city,
        businessCount: row.businessCount,
        avgRating: row.avgRating.toString(),
        totalReviews: row.totalReviews,
        pctWithWebsite: row.pctWithWebsite.toString(),
        pctOutdatedEstimate: pctOutdatedEstimate.toString(),
        opportunityScore: row.opportunityScore.toString(),
        nicheTicketWeight: row.nicheTicketWeight.toString(),
        expiresAt,
      });
    } catch (err) {
      logger.warn({ err: String(err), cell }, "market scout cell failed");
    }
  }

  results.sort((a, b) => b.opportunityScore - a.opportunityScore);
  return results;
}
