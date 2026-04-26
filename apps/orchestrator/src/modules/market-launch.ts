import {
  and,
  desc,
  eq,
  gt,
  sql,
  type DbClient,
  campaigns,
  marketScans,
  prospects,
  type Campaign,
} from "@super-engine/db";
import {
  computeMarketCellScore,
  nicheGroupOf,
  NICHE_TICKET_WEIGHTS,
  runMarketScout,
  type ScoutRow,
} from "./market-scout.js";
import { scrapeProspectsForCampaign, type ScrapeSummary } from "./scrape.js";
import { logger } from "../lib/logger.js";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export interface FreshScoutResult {
  rows: ScoutRow[];
  totalCells: number;
  cacheHit: boolean;
}

export type OperatorIcpPrefs = {
  countries?: string[];
  ticketBand?: string;
  excludedNicheGroups?: string[];
  successDescription?: string;
};

/**
 * Roll up prospect outcomes by campaign niche × country and write outcome_score
 * onto recent market_scans rows so rankings can learn from the pipeline.
 */
export async function aggregateMarketOutcomes(db: DbClient, country: string): Promise<void> {
  const ctry = country.toUpperCase().slice(0, 2);
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const joined = await db
    .select({
      niche: campaigns.niche,
      targetCountry: campaigns.targetCountry,
      state: prospects.state,
    })
    .from(prospects)
    .innerJoin(campaigns, eq(prospects.campaignId, campaigns.id))
    .where(eq(campaigns.targetCountry, ctry));

  const map = new Map<string, { total: number; progressed: number; rejected: number; downstream: number }>();
  const progressedStates = new Set([
    "ENRICHED",
    "QUALIFIED",
    "REDESIGNED",
    "APPROVED_TO_SEND",
    "SENT",
    "RESPONDED",
    "BOOKED",
    "WON",
    "AWAITING",
    "FOLLOWUP_1",
    "FOLLOWUP_2",
  ]);
  const downstreamStates = new Set(["APPROVED_TO_SEND", "SENT", "RESPONDED", "BOOKED", "WON"]);

  for (const r of joined) {
    const key = `${(r.targetCountry ?? "").toUpperCase().slice(0, 2)}|${r.niche.trim().toLowerCase()}`;
    const acc = map.get(key) ?? { total: 0, progressed: 0, rejected: 0, downstream: 0 };
    acc.total++;
    if (progressedStates.has(r.state)) acc.progressed++;
    if (r.state === "REJECTED") acc.rejected++;
    if (downstreamStates.has(r.state)) acc.downstream++;
    map.set(key, acc);
  }

  for (const [key, acc] of map) {
    if (acc.total === 0) continue;
    const nicheKey = key.split("|")[1]!;
    const boost = clamp01(
      0.35 * (acc.progressed / acc.total) +
        0.25 * (1 - acc.rejected / acc.total) +
        0.4 * (acc.downstream / acc.total),
    );
    await db
      .update(marketScans)
      .set({ outcomeScore: boost.toFixed(3) })
      .where(
        and(
          eq(marketScans.country, ctry),
          sql`lower(trim(${marketScans.niche})) = ${nicheKey}`,
          gt(marketScans.createdAt, cutoff),
        ),
      );
  }
}

function applyIcpFilters(rows: ScoutRow[], icp?: OperatorIcpPrefs | null): ScoutRow[] {
  if (!icp?.excludedNicheGroups?.length) return rows;
  const ex = new Set(icp.excludedNicheGroups.map((g) => g.toLowerCase()));
  return rows.filter((r) => !ex.has((r.nicheGroup ?? nicheGroupOf(r.niche)).toLowerCase()));
}

function applyIcpScoreBoost(rows: ScoutRow[], country: string, icp?: OperatorIcpPrefs | null): ScoutRow[] {
  const preferred = icp?.countries?.map((c) => c.toUpperCase().slice(0, 2)) ?? [];
  if (!preferred.length || !preferred.includes(country.toUpperCase().slice(0, 2))) return rows;
  return rows.map((r) => ({
    ...r,
    opportunityScore: Math.min(100, Math.round((r.opportunityScore + 0.5) * 10) / 10),
  }));
}

/**
 * Return the most recent still-fresh scout rows for a country, or run a new
 * scan if none are available. Rows are ordered by opportunity_score desc.
 */
export async function getFreshScoutRows(
  db: DbClient,
  country: string,
  opts: { maxAgeHours?: number; icp?: OperatorIcpPrefs | null } = {},
): Promise<FreshScoutResult> {
  const maxAgeMs = (opts.maxAgeHours ?? 24) * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - maxAgeMs);
  const upper = country.toUpperCase().slice(0, 2);

  await aggregateMarketOutcomes(db, upper);

  const rows = await db
    .select()
    .from(marketScans)
    .where(and(eq(marketScans.country, upper), gt(marketScans.createdAt, cutoff)))
    .orderBy(desc(marketScans.opportunityScore))
    .limit(200);

  if (rows.length > 0) {
    logger.info({ country: upper, rowCount: rows.length }, "scout cache hit");
    const mapped = rows.map((r) => {
      const outcomeRaw = r.outcomeScore != null ? Number(r.outcomeScore) : 0;
      const tw = r.nicheTicketWeight ? Number(r.nicheTicketWeight) : 1;
      const medianApprox =
        r.businessCount && r.totalReviews ? r.totalReviews / Math.max(1, r.businessCount) : 0;
      const rescored = computeMarketCellScore({
        placeCount: r.businessCount ?? 0,
        pctWithWebsite: r.pctWithWebsite ? Number(r.pctWithWebsite) : 0,
        pctOutdatedEstimate: r.pctOutdatedEstimate ? Number(r.pctOutdatedEstimate) : 0,
        medianReviews: medianApprox,
        nicheTicketWeight: tw,
        outcomeBoost: outcomeRaw,
      });
      return {
        niche: r.niche,
        city: r.city,
        country: r.country,
        businessCount: r.businessCount ?? 0,
        avgRating: r.avgRating ? Number(r.avgRating) : 0,
        totalReviews: r.totalReviews ?? 0,
        pctWithWebsite: r.pctWithWebsite ? Number(r.pctWithWebsite) : 0,
        pctOutdatedEstimate: r.pctOutdatedEstimate ? Number(r.pctOutdatedEstimate) : 0,
        opportunityScore: rescored.score,
        nicheTicketWeight: tw,
        scoreBreakdown: rescored.breakdown,
        nicheGroup: nicheGroupOf(r.niche),
        source: r.source ?? "scout",
        scanCreatedAt: r.createdAt?.toISOString?.() ?? undefined,
        outcomeScore: outcomeRaw > 0 ? outcomeRaw : undefined,
      };
    });
    let out = applyIcpFilters(mapped, opts.icp);
    out = applyIcpScoreBoost(out, upper, opts.icp);
    out.sort((a, b) => b.opportunityScore - a.opportunityScore);
    return {
      rows: out,
      totalCells: out.length,
      cacheHit: true,
    };
  }

  logger.info({ country: upper }, "scout cache miss — running fresh scan");
  const scouted = await runMarketScout(db, { country: upper });
  let out = applyIcpFilters(scouted, opts.icp);
  out = applyIcpScoreBoost(out, upper, opts.icp);
  out.sort((a, b) => b.opportunityScore - a.opportunityScore);
  return { rows: out, totalCells: out.length, cacheHit: false };
}

/**
 * Take ranked rows and cap per-niche and per vertical group so lodging variants
 * cannot crowd out the entire list.
 */
export function diversifyByGroup(
  rows: ScoutRow[],
  opts: { perNiche: number; perGroup: number } = { perNiche: 2, perGroup: 3 },
): ScoutRow[] {
  const nicheCounts = new Map<string, number>();
  const groupCounts = new Map<string, number>();
  const out: ScoutRow[] = [];
  for (const r of rows) {
    const g = r.nicheGroup ?? nicheGroupOf(r.niche);
    const nc = nicheCounts.get(r.niche) ?? 0;
    if (nc >= opts.perNiche) continue;
    const gc = groupCounts.get(g) ?? 0;
    if (gc >= opts.perGroup) continue;
    nicheCounts.set(r.niche, nc + 1);
    groupCounts.set(g, gc + 1);
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
 *
 * When `niche` + `city` are passed, launches that exact market (no rank/index).
 */
export async function pickAndLaunch(
  db: DbClient,
  opts: {
    country?: string;
    rank?: number;
    maxProspects?: number;
    niche?: string;
    city?: string;
    /** Default false for scout launches — queue asks before spending on redesign. */
    autoRedesignAfterEnrich?: boolean;
  } = {},
): Promise<LaunchResult> {
  const country = (opts.country ?? "AU").toUpperCase().slice(0, 2);
  const maxProspects = Math.max(1, Math.min(opts.maxProspects ?? 25, 50));

  let pick: ScoutRow;

  if (opts.niche?.trim() && opts.city?.trim()) {
    const n = opts.niche.trim().toLowerCase();
    const city = opts.city.trim();
    const tw = NICHE_TICKET_WEIGHTS[n] ?? 1.0;
    pick = {
      niche: n,
      city,
      country,
      businessCount: 0,
      avgRating: 0,
      totalReviews: 0,
      pctWithWebsite: 0,
      pctOutdatedEstimate: 0,
      opportunityScore: 0,
      nicheTicketWeight: tw,
      nicheGroup: nicheGroupOf(n),
    };
  } else {
    const rank = Math.max(1, opts.rank ?? 1);
    const { rows } = await getFreshScoutRows(db, country);
    const diversified = diversifyByGroup(rows, { perNiche: 2, perGroup: 3 });
    if (diversified.length === 0) {
      throw new Error(`No market opportunities found for country=${country}`);
    }
    pick = diversified[Math.min(rank - 1, diversified.length - 1)]!;
  }

  const name = `${pick.city} ${pick.niche}s`;
  const autoRedesign = opts.autoRedesignAfterEnrich ?? false;
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name,
      niche: pick.niche,
      targetCity: pick.city,
      targetCountry: country.slice(0, 2),
      maxProspects,
      outreachChannel: "both",
      imageryStrategy: "none",
      autoSendEnabled: false,
      autoRedesignAfterEnrich: autoRedesign,
    })
    .returning();

  if (!campaign) throw new Error("Failed to create campaign");

  logger.info(
    {
      campaignId: campaign.id,
      niche: pick.niche,
      city: pick.city,
      score: pick.opportunityScore,
    },
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
  opts: {
    niche: string;
    city: string;
    country: string;
    maxProspects?: number;
    autoRedesignAfterEnrich?: boolean;
  },
): Promise<{ campaign: Campaign; summary: ScrapeSummary }> {
  const niche = opts.niche.trim().toLowerCase();
  const city = opts.city.trim();
  const country = opts.country.toUpperCase().slice(0, 2);
  const maxProspects = Math.max(1, Math.min(opts.maxProspects ?? 25, 50));

  if (!niche || !city) throw new Error("niche and city required");

  const name = `${city} ${niche}s`;
  const autoRedesign = opts.autoRedesignAfterEnrich ?? false;
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name,
      niche,
      targetCity: city,
      targetCountry: country,
      maxProspects,
      outreachChannel: "both",
      imageryStrategy: "none",
      autoSendEnabled: false,
      autoRedesignAfterEnrich: autoRedesign,
    })
    .returning();
  if (!campaign) throw new Error("Failed to create campaign");

  logger.info({ campaignId: campaign.id, niche, city, country, autoRedesign }, "pickAndLaunchCustom: campaign created");

  const summary = await scrapeProspectsForCampaign(db, campaign.id, { maxResults: maxProspects });
  return { campaign, summary };
}
