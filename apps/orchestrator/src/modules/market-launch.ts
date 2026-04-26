import { and, desc, eq, gt, type DbClient, campaigns, marketScans, type Campaign } from "@super-engine/db";
import { runMarketScout, type ScoutRow } from "./market-scout.js";
import { scrapeProspectsForCampaign, type ScrapeSummary } from "./scrape.js";
import { logger } from "../lib/logger.js";

export interface FreshScoutResult {
  rows: ScoutRow[];
  totalCells: number;
  cacheHit: boolean;
}

/**
 * Return the most recent still-fresh scout rows for a country, or run a new
 * scan if none are available. Rows are ordered by opportunity_score desc.
 */
export async function getFreshScoutRows(
  db: DbClient,
  country: string,
  opts: { maxAgeHours?: number } = {},
): Promise<FreshScoutResult> {
  const maxAgeMs = (opts.maxAgeHours ?? 24) * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - maxAgeMs);
  const upper = country.toUpperCase();

  const rows = await db
    .select()
    .from(marketScans)
    .where(and(eq(marketScans.country, upper), gt(marketScans.createdAt, cutoff)))
    .orderBy(desc(marketScans.opportunityScore))
    .limit(200);

  if (rows.length > 0) {
    logger.info({ country: upper, rowCount: rows.length }, "scout cache hit");
    return {
      rows: rows.map((r) => ({
        niche: r.niche,
        city: r.city,
        businessCount: r.businessCount ?? 0,
        avgRating: r.avgRating ? Number(r.avgRating) : 0,
        totalReviews: r.totalReviews ?? 0,
        pctWithWebsite: r.pctWithWebsite ? Number(r.pctWithWebsite) : 0,
        opportunityScore: r.opportunityScore ? Number(r.opportunityScore) : 0,
        nicheTicketWeight: r.nicheTicketWeight ? Number(r.nicheTicketWeight) : 1,
      })),
      totalCells: rows.length,
      cacheHit: true,
    };
  }

  logger.info({ country: upper }, "scout cache miss — running fresh scan");
  const scouted = await runMarketScout(db, { country: upper });
  return { rows: scouted, totalCells: scouted.length, cacheHit: false };
}

/**
 * Take ranked rows and return at most `maxPerNiche` rows per niche so the
 * top-10 shows actual variety instead of nine flavors of "hotel".
 * Preserves the overall score ordering.
 */
export function diversifyByNiche(rows: ScoutRow[], maxPerNiche = 2): ScoutRow[] {
  const seen = new Map<string, number>();
  const out: ScoutRow[] = [];
  for (const r of rows) {
    const c = seen.get(r.niche) ?? 0;
    if (c >= maxPerNiche) continue;
    seen.set(r.niche, c + 1);
    out.push(r);
  }
  return out;
}

export interface LaunchResult {
  campaign: Campaign;
  pick: ScoutRow;
  summary: ScrapeSummary;
}

/**
 * Pick the rank-th best market for a country and spin up a campaign around it:
 * creates the campaign row and immediately runs the Places scrape so the
 * operator has prospects to work with on the next pipeline cycle.
 */
export async function pickAndLaunch(
  db: DbClient,
  opts: { country?: string; rank?: number; maxProspects?: number } = {},
): Promise<LaunchResult> {
  const country = (opts.country ?? "AU").toUpperCase();
  const rank = Math.max(1, opts.rank ?? 1);
  // Cap raised: scrape now multi-queries Places and pulls ~3-5× more raw
  // candidates per campaign, so we can keep more without burning extra ops.
  const maxProspects = Math.max(1, Math.min(opts.maxProspects ?? 25, 50));

  const { rows } = await getFreshScoutRows(db, country);
  const diversified = diversifyByNiche(rows, 2);
  if (diversified.length === 0) {
    throw new Error(`No market opportunities found for country=${country}`);
  }
  const pick = diversified[Math.min(rank - 1, diversified.length - 1)]!;

  const name = `${pick.city} ${pick.niche}s`;
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name,
      niche: pick.niche,
      targetCity: pick.city,
      targetCountry: country.slice(0, 2),
      maxProspects,
      outreachChannel: "linkedin",
      imageryStrategy: "none",
      autoSendEnabled: false,
    })
    .returning();

  if (!campaign) throw new Error("Failed to create campaign");

  logger.info(
    { campaignId: campaign.id, niche: pick.niche, city: pick.city, rank, score: pick.opportunityScore },
    "pickAndLaunch: campaign created",
  );

  const summary = await scrapeProspectsForCampaign(db, campaign.id, { maxResults: maxProspects });

  return { campaign, pick, summary };
}

/**
 * Launch a campaign for an arbitrary niche × city pair the operator chose
 * directly, without going through the ranked scout. Useful when the operator
 * spots a market the scout hasn't covered yet, or wants to bias the search
 * toward something specific.
 */
export async function pickAndLaunchCustom(
  db: DbClient,
  opts: { niche: string; city: string; country: string; maxProspects?: number },
): Promise<{ campaign: Campaign; summary: ScrapeSummary }> {
  const niche = opts.niche.trim().toLowerCase();
  const city = opts.city.trim();
  const country = opts.country.toUpperCase().slice(0, 2);
  const maxProspects = Math.max(1, Math.min(opts.maxProspects ?? 25, 50));

  if (!niche || !city) throw new Error("niche and city required");

  const name = `${city} ${niche}s`;
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name,
      niche,
      targetCity: city,
      targetCountry: country,
      maxProspects,
      outreachChannel: "linkedin",
      imageryStrategy: "none",
      autoSendEnabled: false,
    })
    .returning();
  if (!campaign) throw new Error("Failed to create campaign");

  logger.info({ campaignId: campaign.id, niche, city, country }, "pickAndLaunchCustom: campaign created");

  const summary = await scrapeProspectsForCampaign(db, campaign.id, { maxResults: maxProspects });
  return { campaign, summary };
}
