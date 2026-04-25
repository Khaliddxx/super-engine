import { and, desc, eq, gt, type DbClient, campaigns, marketScans, type Campaign } from "@super-engine/db";
import { runMarketScout, type ScoutRow } from "./market-scout.js";
import { scrapeProspectsForCampaign, type ScrapeSummary } from "./scrape.js";
import { logger } from "../lib/logger.js";

/**
 * Return the most recent still-fresh scout rows for a country, or run a new
 * scan if none are available. Rows are ordered by opportunity_score desc.
 */
export async function getFreshScoutRows(
  db: DbClient,
  country: string,
  opts: { maxAgeHours?: number; maxCells?: number } = {},
): Promise<ScoutRow[]> {
  const maxAgeMs = (opts.maxAgeHours ?? 24) * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - maxAgeMs);
  const upper = country.toUpperCase();

  const rows = await db
    .select()
    .from(marketScans)
    .where(and(eq(marketScans.country, upper), gt(marketScans.createdAt, cutoff)))
    .orderBy(desc(marketScans.opportunityScore))
    .limit(50);

  if (rows.length > 0) {
    logger.info({ country: upper, rowCount: rows.length }, "scout cache hit");
    return rows.map((r) => ({
      niche: r.niche,
      city: r.city,
      businessCount: r.businessCount ?? 0,
      avgRating: r.avgRating ? Number(r.avgRating) : 0,
      totalReviews: r.totalReviews ?? 0,
      pctWithWebsite: r.pctWithWebsite ? Number(r.pctWithWebsite) : 0,
      opportunityScore: r.opportunityScore ? Number(r.opportunityScore) : 0,
      nicheTicketWeight: r.nicheTicketWeight ? Number(r.nicheTicketWeight) : 1,
    }));
  }

  logger.info({ country: upper }, "scout cache miss — running fresh scan");
  return runMarketScout(db, { country: upper, maxCells: opts.maxCells ?? 30 });
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
  const maxProspects = Math.max(1, Math.min(opts.maxProspects ?? 10, 20));

  const rows = await getFreshScoutRows(db, country);
  if (rows.length === 0) {
    throw new Error(`No market opportunities found for country=${country}`);
  }
  const pick = rows[Math.min(rank - 1, rows.length - 1)]!;

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
