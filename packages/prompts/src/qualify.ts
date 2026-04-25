export interface QualifyInput {
  name: string;
  niche: string;
  city: string;
  rating: number | null;
  review_count: number | null;
  detected_year: number | null;
}

export const QUALIFY_PROMPT_V1 = {
  version: "1.1",
  deployedAt: "2026-04-26",
  render: (i: QualifyInput) => `You are evaluating whether a local business website would benefit from a modern redesign.
You'll be shown a screenshot of the current website homepage.

<business>
Name: ${i.name}
Niche: ${i.niche}
City: ${i.city}
Rating: ${i.rating ?? "unknown"} (${i.review_count ?? 0} reviews)
Estimated site age: ${i.detected_year ?? "unknown"}
</business>

<context>
We are only interested in prospects whose site is clearly hurting them.
If the visible homepage shows ALL of the following:
  - a functioning reservations/booking widget, OR an embedded virtual tour / 360 / 3D tour
  - rich, high-quality photography (not stock, not placeholder)
  - a coherent modern aesthetic (considered type, whitespace, a real identity)
  - a sticky CTA or nav that clearly works on mobile
then the site is already strong and we should PASS ON IT, even if the aesthetics aren't perfect.
Our pitch is that we'd produce something better. If we can't credibly produce something better than what's there, skip.
</context>

Rate the site on these dimensions (1-5, 1=worst, 5=best):
- Visual modernity (typography, spacing, color use)
- Information hierarchy (can a visitor find what they need?)
- Mobile-readiness (is it clearly responsive?)
- Trust signals (professional appearance, credibility)
- Conversion potential (clear CTAs, booking flow)

A site qualifies for redesign outreach if:
- At least 2 dimensions score ≤ 2
- Overall score is ≤ 3.5
- The business has enough review volume to suggest they care about their reputation (reviews > 30)
- AND the site is NOT already modern per the <context> above

If you see clear signs of a modern booking engine, virtual tour, current copyright year, or a polished identity,
set pass=false and include "already_modern" as the first item in top_issues, even if one dimension scores low.

Return JSON ONLY (no prose, no markdown fences):
{
  "pass": boolean,
  "score": number (0-5, average),
  "dimension_scores": { "visual": N, "hierarchy": N, "mobile": N, "trust": N, "conversion": N },
  "reasoning": "2-3 sentences explaining your call",
  "top_issues": ["specific issue 1", "specific issue 2", "specific issue 3"]
}`,
};
