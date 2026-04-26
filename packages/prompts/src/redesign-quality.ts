export interface RedesignQualityInput {
  name: string;
  niche: string;
  city: string;
  qualification_issues: string[];
}

function list(items: string[]): string {
  if (!items.length) return "(none recorded)";
  return items.map((s) => `- ${s}`).join("\n");
}

export const REDESIGN_QUALITY_PROMPT_V1 = {
  version: "1.0",
  deployedAt: "2026-04-26",
  render: (i: RedesignQualityInput) => `You are the quality gate for an automated website-redesign pipeline.

You will receive TWO mobile screenshots:
IMAGE 1 = the business's existing live website.
IMAGE 2 = our proposed redesign.

Business: ${i.name}
Niche: ${i.niche}
City: ${i.city}

The original site was selected because of these observed issues:
${list(i.qualification_issues)}

Your job is NOT to reward novelty. Your job is to protect the operator from
shipping a redesign that is more broken, cheaper-looking, harder to use, or
less credible than the original.

Score both screenshots from 0-10 as a real mobile website:
- visual polish and trust
- hierarchy and readability on phone
- conversion clarity
- use of real brand/content/assets
- layout integrity: no broken crops, weird spacing, tiny text, invisible text,
  awkward overlays, buttons that look disabled, or content that feels pasted in
- whether the redesign clearly fixes the original site's issues instead of
  creating new ones

Hard fail the redesign if ANY are true:
- It looks less credible than the original.
- It looks like an AI/template demo rather than a real business website.
- It has obvious broken layout, bad spacing, unreadable text, or awkward image crops.
- It removes important trust/content from the original without replacing it with
  something stronger.
- The improvement is marginal. We only ship if it is clearly better.

Pass policy:
- pass=true only if redesign_score >= 7 AND redesign_score >= original_score + 1.
- pass=false if redesign_score < 7, or the redesign is only different, not better.

Return JSON ONLY:
{
  "pass": boolean,
  "original_score": number,
  "redesign_score": number,
  "delta": number,
  "verdict": "short plain-English verdict",
  "fatal_issues": ["specific issue 1", "specific issue 2"],
  "better_than_original": ["specific improvement 1"],
  "repair_instruction": "one compact instruction paragraph to give the designer on the next attempt"
}`,
};
