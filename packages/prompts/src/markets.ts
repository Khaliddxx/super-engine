export interface MarketDiscoveryInput {
  countries: string[];
  ticket_band?: string;
  excluded_niche_groups: string[];
  success_description?: string;
  recent_win_summary?: string;
}

export const MARKET_DISCOVERY_PROMPT_V1 = {
  version: "1.0",
  deployedAt: "2026-04-26",
  render: (i: MarketDiscoveryInput) => `You help a web-design agency find LOCAL B2B-style markets to pitch website redesigns.
Return ONLY valid JSON (no markdown fences). Shape:
{ "candidates": [
  {
    "niche": "short google-friendly niche phrase in english, lowercase (e.g. cosmetic dentist, boutique law firm)",
    "city": "city name only, proper casing",
    "country": "two-letter ISO country code matching one of the operator countries",
    "rationale": "one sentence why this cell is a good fit",
    "ticket_guess": "low" | "mid" | "high",
    "evidence_query": "single line text query for Google Places text search, e.g. cosmetic dentist in Austin"
  }
] }

Rules:
- Propose 10–12 candidates total. Favor variety across DIFFERENT niche families (do not repeat hotel/lodging patterns).
- Avoid: hotel, resort, motel, hostel, boutique hotel unless the operator explicitly wants lodging.
- Each candidate must use a city that plausibly has many independent local businesses in that niche.
- country MUST be one of: ${i.countries.join(", ")}.
- ticket_guess should align with typical redesign budgets for that niche.
- evidence_query must be specific: "{niche} in {city}" style is OK.
- If excluded_niche_groups is non-empty, do not propose niches that clearly belong to those groups. Excluded groups: ${i.excluded_niche_groups.length ? i.excluded_niche_groups.join(", ") : "(none)"}.
- Ticket / ICP hint: ${i.ticket_band ?? "any"}.
- What success looks like for this operator: ${i.success_description?.trim() || "(not specified)"}.
- Recent wins / lessons (optional): ${i.recent_win_summary?.trim() || "(none)"}.
`,
};
