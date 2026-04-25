import { campaigns, prospects, eq, and, type DbClient } from "@super-engine/db";
import { textSearch } from "../integrations/places.js";
import { timezoneFor } from "../lib/time.js";
import { logger } from "../lib/logger.js";

export interface ScrapeSummary {
  found: number;
  inserted: number;
  skippedNoWebsite: number;
  skippedDuplicateDomain: number;
  skippedChainDomain: number;
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

  const limit = Math.min(opts.maxResults ?? campaign.maxProspects ?? 20, 20);
  const query = `${campaign.niche} in ${campaign.targetCity ?? ""}`.trim();
  logger.info({ query, campaignId }, "places textSearch");
  const results = await textSearch(query, { max: limit });

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
  };

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
    existingDomains.add(domain);

    await db
      .insert(prospects)
      .values({
        campaignId,
        state: "NEW",
        businessName: p.name,
        niche: campaign.niche,
        city: campaign.targetCity,
        country: campaign.targetCountry,
        website: p.website,
        phone: p.phone,
        googlePlaceId: p.placeId,
        rating: p.rating ? String(p.rating) : null,
        reviewCount: p.userRatingCount ?? null,
        latitude: p.lat ? String(p.lat) : null,
        longitude: p.lng ? String(p.lng) : null,
        timezone: timezoneFor(p.lat, p.lng),
      })
      .onConflictDoNothing({ target: prospects.googlePlaceId });
    summary.inserted++;
  }

  logger.info({ summary, campaignId }, "scrape complete");
  return summary;
}
