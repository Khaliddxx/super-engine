import { campaigns, prospects, eq, and, type DbClient } from "@super-engine/db";
import { textSearchMulti } from "../integrations/places.js";
import { timezoneFor } from "../lib/time.js";
import { logger } from "../lib/logger.js";
import { analyzeSiteStrength, type SiteStrengthResult } from "./site-strength.js";

export interface ScrapeSummary {
  found: number;
  inserted: number;
  skippedNoWebsite: number;
  skippedDuplicateDomain: number;
  skippedChainDomain: number;
  skippedSiteAlreadyStrong: number;
  skippedTooPolished: number;
  /** Inserted as NEW despite site-strength homepage fetch failing (403/timeout); qualify will still vision-check. */
  insertedWithHomepageFetchFailed: number;
}

// Domains that are chain/franchise properties — the website is corporate, not local.
// Scraping these wastes Firecrawl credits and the prospect has no decision-making power.
const CHAIN_DOMAIN_SUBSTRINGS = [
  "marriott",
  "hilton",
  "hyatt",
  "ihg",
  "accor",
  "radisson",
  "wyndham",
  "choicehotels",
  "bestwestern",
  "fourseasons",
  "ritzcarlton",
  "intercontinental",
  "holiday-inn",
  "holidayinn",
  "crowneplaza",
  "doubletree",
  "hampton",
  "residenceinn",
  "courtyard",
  "novotel",
  "ibis",
  "mercure",
  "sofitel",
  "pullman",
  "trivago",
  "booking.com",
  "expedia",
  "hotels.com",
  "agoda",
  "tripadvisor",
  "airbnb",
  "vrbo",
  "mcdonalds",
  "starbucks",
  "subway.com",
  "dominos",
  "pizzahut",
  "kfc.com",
  "burgerking",
  "wendys",
  "tacobell",
  "chipotle",
  "dunkin",
  "costa.co",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "google.com",
  "business.site",
  "yelp.com",
  "yellowpages",
];

function isChainDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return CHAIN_DOMAIN_SUBSTRINGS.some((c) => d.includes(c));
}

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Build a set of varied Places queries for one niche+city. Each variant pulls
 * a different slice of Google's index, so combined dedupe gives us 4-6× the
 * raw volume of a single "X in Y" search. This is the single biggest lever
 * for scout volume — Places (New) caps each individual query at 60 results.
 */
export function buildSearchVariants(niche: string, city: string | null | undefined): string[] {
  const c = (city ?? "").trim();
  const n = niche.trim();
  if (!c) return [n];
  const base = [
    `${n} in ${c}`,
    `${c} ${n}`,
    `best ${n} in ${c}`,
    `top ${n} ${c}`,
    `${n} near ${c}`,
    `${n} ${c}`,
  ];
  // Some niches read better in plural — e.g. "law firms in Bangkok"
  // out-of-the-box already, but "nightclub in Bangkok" misses "nightclubs".
  const plural = n.endsWith("s") ? n : `${n}s`;
  if (plural !== n) {
    base.push(`${plural} in ${c}`, `${c} ${plural}`);
  }
  // Dedupe (case-insensitive) while keeping insertion order.
  const seen = new Set<string>();
  return base.filter((q) => {
    const k = q.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function scrapeProspectsForCampaign(
  db: DbClient,
  campaignId: string,
  opts: { maxResults?: number } = {},
): Promise<ScrapeSummary> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  // We need WAY more candidates than we want to keep, because the
  // outdated-site filter rejects 60-80% of what Places returns. Bumping the
  // candidate pool is the cheapest way to raise yield.
  // Hard cap of 50 keepers per scrape so a single search doesn't bloat the
  // queue — anything more should come from another campaign or a new run.
  const desiredKeep = Math.max(1, Math.min(opts.maxResults ?? campaign.maxProspects ?? 25, 50));
  const queries = buildSearchVariants(campaign.niche, campaign.targetCity);
  logger.info(
    { queries, campaignId, desiredKeep, queryCount: queries.length },
    "places textSearch (multi-query)",
  );
  const results = await textSearchMulti(queries, { maxPerQuery: 60, totalMax: 240 });

  const existingDomains = new Set<string>();
  const existingRows = await db.select({ website: prospects.website }).from(prospects);
  for (const r of existingRows) {
    if (r.website) {
      const d = extractDomain(r.website);
      if (d) existingDomains.add(d);
    }
  }

  const summary: ScrapeSummary = {
    found: results.length,
    inserted: 0,
    skippedNoWebsite: 0,
    skippedDuplicateDomain: 0,
    skippedChainDomain: 0,
    skippedSiteAlreadyStrong: 0,
    skippedTooPolished: 0,
    insertedWithHomepageFetchFailed: 0,
  };

  // Pre-filter pass: drop chains, dupes, and obviously polished businesses.
  type Candidate = (typeof results)[number] & { domain: string };
  const candidates: Candidate[] = [];
  for (const p of results) {
    if (!p.website) {
      summary.skippedNoWebsite++;
      continue;
    }
    const domain = extractDomain(p.website);
    if (!domain) {
      summary.skippedNoWebsite++;
      continue;
    }
    if (isChainDomain(domain)) {
      summary.skippedChainDomain++;
      continue;
    }
    if (existingDomains.has(domain)) {
      summary.skippedDuplicateDomain++;
      continue;
    }
    candidates.push({ ...p, domain });
  }

  // Outdated-site filter: businesses with >=4.7 stars and >=800 reviews almost
  // always have a polished site already. We're hunting for the messy middle —
  // legitimate local businesses with thin or stale websites.
  function looksTooPolished(p: { rating: number | null; userRatingCount: number | null }): boolean {
    return (p.rating ?? 0) >= 4.7 && (p.userRatingCount ?? 0) >= 800;
  }

  // Run structural site-strength on each remaining candidate in parallel.
  const strengthPairs = await Promise.all(
    candidates.map(async (c) => {
      try {
        const s = await analyzeSiteStrength(c.website!);
        return { c, strength: s as SiteStrengthResult };
      } catch (err) {
        logger.warn({ err: String(err), website: c.website }, "site-strength failed in scrape");
        return { c, strength: null as SiteStrengthResult | null };
      }
    }),
  );

  // Score outdated-ness: lower structural strength = more outdated = better target.
  // Do NOT penalize homepage fetch failures here — those were mis-bucketed as
  // "too polished" and killed yield; we still insert and let qualify (Microlink + vision) decide.
  const scored = strengthPairs
    .map(({ c, strength }) => {
      const polishedScore = looksTooPolished(c) ? 1 : 0;
      const strengthScore = strength ? strength.score : 0;
      const composite = strengthScore + polishedScore * 2;
      return { c, strength, composite };
    })
    .sort((a, b) => a.composite - b.composite);

  // Keep up to desiredKeep prospects, skipping anything with strength.strong
  // OR composite score >=4 (heavy "already polished" smell). This is the gate
  // that turns "best of the best" into "outdated middle".
  for (const item of scored) {
    if (summary.inserted >= desiredKeep) break;
    const { c, strength, composite } = item;

    if (strength?.strong) {
      summary.skippedSiteAlreadyStrong++;
      continue;
    }
    if (composite >= 4) {
      summary.skippedTooPolished++;
      continue;
    }

    if (strength && strength.scannedHomepageOk === false) {
      summary.insertedWithHomepageFetchFailed++;
    }

    existingDomains.add(c.domain);
    await db
      .insert(prospects)
      .values({
        campaignId,
        state: "NEW",
        businessName: c.name,
        niche: campaign.niche,
        city: campaign.targetCity,
        country: campaign.targetCountry,
        website: c.website,
        phone: c.phone,
        googlePlaceId: c.placeId,
        rating: c.rating ? String(c.rating) : null,
        reviewCount: c.userRatingCount ?? null,
        latitude: c.lat ? String(c.lat) : null,
        longitude: c.lng ? String(c.lng) : null,
        timezone: timezoneFor(c.lat, c.lng),
        siteStrengthScore: strength ? String(strength.score) : null,
        siteStrengthSignals: (strength?.signals as any) ?? null,
      })
      .onConflictDoNothing({ target: prospects.googlePlaceId });
    summary.inserted++;
  }

  logger.info({ summary, campaignId }, "scrape complete (outdated-site filter active)");
  return summary;
}
