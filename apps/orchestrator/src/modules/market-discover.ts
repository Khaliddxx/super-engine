import { marketScans, type DbClient } from "@super-engine/db";
import { MARKET_DISCOVERY_PROMPT_V1 } from "@super-engine/prompts";
import { claudeText, extractJson } from "../integrations/claude.js";
import { textSearch } from "../integrations/places.js";
import {
  computeMarketCellScore,
  estimateOutdatedRate,
  nicheGroupOf,
  NICHE_TICKET_WEIGHTS,
  normalizeCountry,
  type ScoutRow,
} from "./market-scout.js";
import { logger } from "../lib/logger.js";
import crypto from "node:crypto";
import type { OperatorIcpPrefs } from "./market-launch.js";

interface DiscoveryCandidate {
  niche: string;
  city: string;
  country: string;
  rationale?: string;
  ticket_guess?: string;
  evidence_query?: string;
}

function ticketWeightFromGuess(guess: string | undefined): number {
  const g = (guess ?? "mid").toLowerCase();
  if (g === "high") return 1.75;
  if (g === "low") return 0.85;
  return 1.15;
}

export async function runAiMarketDiscover(
  db: DbClient,
  opts: { country: string; icp?: OperatorIcpPrefs | null },
): Promise<{ inserted: number; validated: ScoutRow[]; rawCount: number }> {
  const country = normalizeCountry(opts.country);
  const icp = opts.icp ?? {};
  const countries = icp.countries?.length ? icp.countries.map((c) => c.toUpperCase().slice(0, 2)) : [country];
  if (!countries.includes(country)) countries.push(country);

  const prompt = MARKET_DISCOVERY_PROMPT_V1.render({
    countries,
    ticket_band: icp.ticketBand,
    excluded_niche_groups: icp.excludedNicheGroups ?? [],
    success_description: icp.successDescription,
    recent_win_summary: undefined,
  });

  const rawText = await claudeText(prompt, { maxTokens: 3500, temperature: 0.9 });
  const parsed = extractJson<{ candidates: DiscoveryCandidate[] }>(rawText);
  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const scanRunId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const validated: ScoutRow[] = [];
  let inserted = 0;

  for (const c of candidates) {
    try {
      const rowCountry = normalizeCountry(c.country);
      if (rowCountry !== country) continue;
      const niche = (c.niche ?? "").trim().toLowerCase();
      const city = (c.city ?? "").trim();
      if (!niche || !city) continue;
      const query = (c.evidence_query ?? `${niche} in ${city}`).trim();
      const places = await textSearch(query, { max: 20 });
      const websiteUrls = places.map((p) => p.website).filter((u): u is string => Boolean(u));
      const withWebsite = websiteUrls.length;
      const totalReviews = places.reduce((s, p) => s + (p.userRatingCount ?? 0), 0);
      const rated = places.filter((p) => p.rating !== null);
      const avgRating = rated.length ? rated.reduce((s, p) => s + (p.rating ?? 0), 0) / rated.length : 0;
      const pctWithWebsite = places.length ? withWebsite / places.length : 0;
      if (places.length < 6 || pctWithWebsite < 0.4) {
        logger.info({ query, places: places.length, pctWithWebsite }, "discover: candidate rejected by probe");
        continue;
      }
      const pctOutdatedEstimate = await estimateOutdatedRate(websiteUrls);
      const tw =
        NICHE_TICKET_WEIGHTS[niche] ?? Math.max(0.7, Math.min(2, ticketWeightFromGuess(c.ticket_guess)));
      const reviewCounts = places.map((p) => p.userRatingCount ?? 0).sort((a, b) => a - b);
      const medianReviews = reviewCounts.length
        ? reviewCounts[Math.floor(reviewCounts.length / 2)] ?? 0
        : 0;
      const scored = computeMarketCellScore({
        placeCount: places.length,
        pctWithWebsite,
        pctOutdatedEstimate,
        medianReviews,
        nicheTicketWeight: tw,
      });

      const row: ScoutRow = {
        niche,
        city,
        country: rowCountry,
        businessCount: places.length,
        avgRating: Math.round(avgRating * 10) / 10,
        totalReviews,
        pctWithWebsite: Math.round(pctWithWebsite * 100) / 100,
        pctOutdatedEstimate,
        scoreBreakdown: scored.breakdown,
        opportunityScore: scored.score,
        nicheTicketWeight: tw,
        nicheGroup: nicheGroupOf(niche),
        source: "ai-discovery",
      };
      validated.push(row);

      await db.insert(marketScans).values({
        scanRunId,
        country: rowCountry,
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
        source: "ai-discovery",
      });
      inserted++;
    } catch (err) {
      logger.warn({ err: String(err), candidate: c }, "discover: candidate failed");
    }
  }

  return { inserted, validated, rawCount: candidates.length };
}
