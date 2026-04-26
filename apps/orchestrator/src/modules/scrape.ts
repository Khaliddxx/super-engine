import { campaigns, prospects, eq, and, type DbClient } from "@super-engine/db";
import { textSearch } from "../integrations/places.js";
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

export async function scrapeProspectsForCampaign(
  db: DbClient,
  campaignId: string,
  opts: { maxResults?: number } = {},
): Promise<ScrapeSummary> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  // We need MORE candidates than we want to keep, because we now filter for
  // outdated sites client-side. Google Places returns the "best of the best"
  // by default; most of those have decent websites and aren't real targets.
  // Pull up to 20 (Places' hard cap), then filter down.
  const desiredKeep = Math.min(opts.maxResults ?? campaign.maxProspects ?? 20, 20);
  const placesLimit = 20;
  const query = `${campaign.niche} in ${campaign.targetCity ?? ""}`.trim();
  logger.info({ query, campaignId, desiredKeep }, "places textSearch");
  const results = await textSearch(query, { max: placesLimit });

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

  // Score outdated-ness: lower strength = more outdated = better target.
  const scored = strengthPairs
    .map(({ c, strength }) => {
      const polishedScore = looksTooPolished(c) ? 1 : 0;
      const strengthScore = strength ? strength.score : 0;
      // Composite "polished score" (lower is better target). Also penalize
      // sites that didn't even have a working homepage (status != 200) so
      // we don't waste credits on dead links.
      const composite = strengthScore + polishedScore * 2 + (strength?.scannedHomepageOk === false ? 5 : 0);
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
