import { marketScans, type DbClient } from "@super-engine/db";
import { textSearch } from "../integrations/places.js";
import { logger } from "../lib/logger.js";
import crypto from "node:crypto";

/**
 * Niche → average deal value weight (higher = pricier redesigns these owners
 * can pay for). Adding new niches is a one-line change.
 */
export const NICHE_TICKET_WEIGHTS: Record<string, number> = {
  // High-ticket
  "wedding venue": 2.0,
  "boutique hotel": 2.0,
  "hotel": 2.0,
  "luxury resort": 2.0,
  "private clinic": 1.8,
  "cosmetic surgeon": 1.8,
  "fertility clinic": 1.8,
  "ivf clinic": 1.8,
  "orthodontist": 1.6,
  "dentist": 1.5,
  "dermatologist": 1.5,
  "med spa": 1.5,
  "law firm": 1.5,
  "real estate agency": 1.4,
  "architect": 1.4,
  "interior designer": 1.4,
  "boutique winery": 1.3,
  // Mid-ticket
  "plumber": 1.2,
  "hvac": 1.2,
  "electrician": 1.2,
  "roofing contractor": 1.2,
  "landscaper": 1.1,
  "veterinarian": 1.1,
  "physiotherapist": 1.1,
  "chiropractor": 1.1,
  "optometrist": 1.1,
  "yoga studio": 1.0,
  "pilates studio": 1.0,
  "personal trainer": 1.0,
  "massage clinic": 1.0,
  "music school": 1.0,
  "dance studio": 1.0,
  "tattoo studio": 1.0,
  // Lower-ticket but high-volume
  "fine dining restaurant": 1.1,
  "restaurant": 0.8,
  "cafe": 0.8,
  "bakery": 0.8,
  "wine bar": 0.9,
  "brewery": 0.9,
  "bar": 0.8,
  "ice cream shop": 0.7,
  "nail salon": 0.7,
  "hair salon": 0.7,
  "barber shop": 0.7,
  "florist": 0.7,
  "photographer": 1.0,
  "videographer": 1.0,
  "florists": 0.7,
  "pet groomer": 0.7,
  "tutoring center": 0.9,
};

/**
 * Country → cities to scan. Adding a country is a one-line change. We keep
 * cities to "places where local businesses actually exist" (skip megacities
 * dominated by chains where possible).
 */
export const CITY_SETS: Record<string, string[]> = {
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
    "Wollongong",
    "Sunshine Coast",
    "Cairns",
    "Darwin",
    "Townsville",
  ],
  US: [
    "Austin",
    "Denver",
    "Portland",
    "Nashville",
    "Raleigh",
    "Charlotte",
    "Boulder",
    "Asheville",
    "Charleston",
    "Savannah",
    "Boise",
    "Salt Lake City",
    "Bozeman",
    "Ann Arbor",
    "Madison",
    "Burlington",
    "Sarasota",
    "Sedona",
    "Santa Barbara",
    "Carmel",
  ],
  UK: [
    "Bristol",
    "Manchester",
    "Leeds",
    "Edinburgh",
    "Cardiff",
    "Brighton",
    "Bath",
    "York",
    "Cambridge",
    "Oxford",
    "Glasgow",
    "Liverpool",
    "Newcastle upon Tyne",
    "Norwich",
    "Belfast",
  ],
  NL: ["Amsterdam", "Rotterdam", "Utrecht", "The Hague", "Eindhoven", "Haarlem", "Groningen", "Maastricht", "Leiden", "Delft"],
  CA: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa", "Halifax", "Victoria", "Quebec City", "Edmonton", "Kelowna"],
  IE: ["Dublin", "Cork", "Galway", "Limerick", "Kilkenny"],
  NZ: ["Auckland", "Wellington", "Christchurch", "Queenstown", "Tauranga"],
  DE: ["Berlin", "Munich", "Hamburg", "Cologne", "Frankfurt", "Düsseldorf", "Leipzig", "Stuttgart"],
  FR: ["Paris", "Lyon", "Marseille", "Bordeaux", "Toulouse", "Nice", "Nantes", "Lille"],
  ES: ["Madrid", "Barcelona", "Valencia", "Seville", "Bilbao", "Málaga"],
  IT: ["Rome", "Milan", "Florence", "Bologna", "Naples", "Turin"],
  PT: ["Lisbon", "Porto", "Faro", "Braga"],
  AE: ["Dubai", "Abu Dhabi"],
};

export const SUPPORTED_COUNTRIES = Object.keys(CITY_SETS);

export interface ScoutOptions {
  country: string;
  maxCells?: number;
  niches?: string[];
  cities?: string[];
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
  const cities = opts.cities ?? CITY_SETS[country] ?? CITY_SETS.AU!;
  const niches = opts.niches ?? Object.keys(NICHE_TICKET_WEIGHTS);
  // We have a much wider grid now (~50 niches × 15 cities = 750 cells per
  // country). Don't scan the whole thing on every rescan — that's a lot of
  // Places quota. Instead cap at 60 cells per run and randomly seed which
  // (niche, city) pairs we try. Subsequent runs cover different territory,
  // and the marketScans cache aggregates them over time.
  const maxCells = Math.min(opts.maxCells ?? 60, niches.length * cities.length);

  // Build full cartesian product, then shuffle for variety per scan.
  const allCells: Array<{ niche: string; city: string }> = [];
  for (const c of cities) for (const n of niches) allCells.push({ niche: n, city: c });

  for (let i = allCells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allCells[i], allCells[j]] = [allCells[j]!, allCells[i]!];
  }
  const trimmed = allCells.slice(0, maxCells);

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
      // Median review count per business — better signal than sum (which
      // lets chain niches like "hotel" with 10k-review flagships dominate).
      // We want "healthy independent local businesses", not "every top-20
      // place is a corporate chain".
      const reviewCounts = places.map((p) => p.userRatingCount ?? 0).sort((a, b) => a - b);
      const medianReviews = reviewCounts.length
        ? reviewCounts[Math.floor(reviewCounts.length / 2)] ?? 0
        : 0;
      const opportunityScore =
        Math.log(Math.max(places.length, 1)) *
        pctOutdatedEstimate *
        Math.max(Math.log(medianReviews + 10), 1) *
        tw *
        // If <25% of top businesses have a website, they're not buying
        // redesigns. Otherwise let it flow linearly.
        Math.max(pctWithWebsite, 0.25);

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
