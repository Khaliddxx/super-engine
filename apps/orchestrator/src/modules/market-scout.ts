import { marketScans, type DbClient } from "@super-engine/db";
import { textSearch } from "../integrations/places.js";
import { analyzeSiteStrength } from "./site-strength.js";
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

export function normalizeCountry(input: string | null | undefined): string {
  const c = (input ?? "").trim().toUpperCase();
  if (!c) return "US";
  if (!SUPPORTED_COUNTRIES.includes(c)) {
    throw new Error(`unsupported_country:${c}`);
  }
  return c;
}

export interface ScoutOptions {
  country: string;
  maxCells?: number;
  niches?: string[];
  cities?: string[];
}

export interface ScoutRow {
  niche: string;
  city: string;
  country?: string;
  businessCount: number;
  avgRating: number;
  totalReviews: number;
  pctWithWebsite: number;
  pctOutdatedEstimate: number;
  scoreBreakdown?: {
    outdatedNeed: number;
    contactability: number;
    independentness: number;
    valuePotential: number;
    demandDepth: number;
  };
  opportunityScore: number;
  nicheTicketWeight: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function computeScore(
  args: {
    placeCount: number;
    pctWithWebsite: number;
    pctOutdatedEstimate: number;
    medianReviews: number;
    nicheTicketWeight: number;
  },
): { score: number; breakdown: ScoutRow["scoreBreakdown"] } {
  const outdatedNeed = clamp01(args.pctOutdatedEstimate);
  const contactability = clamp01(args.pctWithWebsite);
  // Smaller median review usually indicates less chain-heavy / more independent.
  const independentness = clamp01(1 - Math.log1p(Math.min(args.medianReviews, 5000)) / Math.log1p(5000));
  const valuePotential = clamp01((args.nicheTicketWeight - 0.6) / (2.0 - 0.6));
  const demandDepth = clamp01(Math.log1p(args.placeCount) / Math.log1p(20));
  const score =
    outdatedNeed * 0.36 +
    contactability * 0.24 +
    independentness * 0.2 +
    valuePotential * 0.14 +
    demandDepth * 0.06;
  return {
    score: Math.round(score * 1000) / 10, // 0..100
    breakdown: {
      outdatedNeed: Math.round(outdatedNeed * 100) / 100,
      contactability: Math.round(contactability * 100) / 100,
      independentness: Math.round(independentness * 100) / 100,
      valuePotential: Math.round(valuePotential * 100) / 100,
      demandDepth: Math.round(demandDepth * 100) / 100,
    },
  };
}

async function estimateOutdatedRate(websites: string[]): Promise<number> {
  const sample = websites.slice(0, 5);
  if (sample.length === 0) return 0;
  const strengths = await Promise.all(
    sample.map((url) =>
      analyzeSiteStrength(url).catch((err) => {
        logger.warn({ err: String(err), url }, "market scout site-strength sample failed");
        return null;
      }),
    ),
  );
  const scanned = strengths.filter(Boolean);
  if (scanned.length === 0) return 0;

  // Weak means "this site probably has visible redesign leverage". Strong
  // sites are actively bad leads for this product, so they reduce the market.
  const weak = scanned.filter((s) => s && !s.strong && s.score < 2.5).length;
  return Math.round((weak / scanned.length) * 100) / 100;
}

export async function runMarketScout(db: DbClient, opts: ScoutOptions): Promise<ScoutRow[]> {
  const scanRunId = crypto.randomUUID();
  const country = normalizeCountry(opts.country);
  const cities = opts.cities ?? CITY_SETS[country] ?? [];
  const niches = opts.niches ?? Object.keys(NICHE_TICKET_WEIGHTS);
  // We have a wide grid (~50 niches × 15 cities = 750 cells per country).
  // Scoring now samples live websites for outdated signals, so each cell is
  // more valuable but more expensive. Keep scans smaller and better.
  const maxCells = Math.min(opts.maxCells ?? 24, niches.length * cities.length);

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
      const websiteUrls = places.map((p) => p.website).filter((u): u is string => Boolean(u));
      const withWebsite = websiteUrls.length;
      const totalReviews = places.reduce((s, p) => s + (p.userRatingCount ?? 0), 0);
      const rated = places.filter((p) => p.rating !== null);
      const avgRating = rated.length ? rated.reduce((s, p) => s + (p.rating ?? 0), 0) / rated.length : 0;
      const pctWithWebsite = places.length ? withWebsite / places.length : 0;
      const pctOutdatedEstimate = await estimateOutdatedRate(websiteUrls);
      const tw = NICHE_TICKET_WEIGHTS[cell.niche] ?? 1.0;
      // Median review count per business — better signal than sum (which
      // lets chain niches like "hotel" with 10k-review flagships dominate).
      // We want "healthy independent local businesses", not "every top-20
      // place is a corporate chain".
      const reviewCounts = places.map((p) => p.userRatingCount ?? 0).sort((a, b) => a - b);
      const medianReviews = reviewCounts.length
        ? reviewCounts[Math.floor(reviewCounts.length / 2)] ?? 0
        : 0;
      const scored = computeScore({
        placeCount: places.length,
        pctWithWebsite,
        pctOutdatedEstimate,
        medianReviews,
        nicheTicketWeight: tw,
      });

      const row: ScoutRow = {
        niche: cell.niche,
        city: cell.city,
        country,
        businessCount: places.length,
        avgRating: Math.round(avgRating * 10) / 10,
        totalReviews,
        pctWithWebsite: Math.round(pctWithWebsite * 100) / 100,
        pctOutdatedEstimate,
        scoreBreakdown: scored.breakdown,
        opportunityScore: scored.score,
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
