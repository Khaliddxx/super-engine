import type { Prospect } from "@super-engine/db";
import { REDESIGN_QUALITY_PROMPT_V1 } from "@super-engine/prompts";
import { RedesignQualityAuditSchema, type RedesignQualityAudit } from "@super-engine/schemas";
import { claudeVisionMulti, extractJson } from "../integrations/claude.js";
import { screenshot } from "../integrations/places.js";
import { logger } from "../lib/logger.js";

export interface RedesignQualityCheckInput {
  prospect: Prospect;
  candidateUrl: string;
}

export interface RedesignQualityCheckResult {
  ok: boolean;
  originalScreenshotUrl: string | null;
  candidateScreenshotUrl: string | null;
  audit: RedesignQualityAudit | null;
}

async function getOriginalScreenshot(prospect: Prospect): Promise<string | null> {
  if (prospect.screenshotUrl) return prospect.screenshotUrl;
  if (!prospect.website) return null;
  return screenshot(prospect.website, { width: 390, height: 844 }).catch((err) => {
    logger.warn({ prospectId: prospect.id, err: String(err) }, "original mobile screenshot failed");
    return null;
  });
}

export async function checkRedesignQuality(input: RedesignQualityCheckInput): Promise<RedesignQualityCheckResult> {
  const originalScreenshotUrl = await getOriginalScreenshot(input.prospect);
  if (!originalScreenshotUrl) {
    return {
      ok: true,
      originalScreenshotUrl: null,
      candidateScreenshotUrl: null,
      audit: null,
    };
  }

  const candidateScreenshotUrl = await screenshot(input.candidateUrl, { width: 390, height: 844 }).catch((err) => {
    logger.warn({ prospectId: input.prospect.id, candidateUrl: input.candidateUrl, err: String(err) }, "candidate screenshot failed");
    return null;
  });
  if (!candidateScreenshotUrl) {
    return {
      ok: false,
      originalScreenshotUrl,
      candidateScreenshotUrl: null,
      audit: {
        pass: false,
        original_score: 0,
        redesign_score: 0,
        delta: 0,
        verdict: "Could not capture the redesign screenshot, so it is not safe to ship.",
        fatal_issues: ["Could not capture redesign screenshot"],
        better_than_original: [],
        repair_instruction: "Regenerate a simpler, more robust mobile-first page with visible content above the fold and no fragile layout effects.",
      },
    };
  }

  const prompt = REDESIGN_QUALITY_PROMPT_V1.render({
    name: input.prospect.businessName,
    niche: input.prospect.niche,
    city: input.prospect.city ?? "",
    qualification_issues: input.prospect.qualificationIssues ?? [],
  });

  try {
    const raw = await claudeVisionMulti(prompt, [originalScreenshotUrl, candidateScreenshotUrl], { maxTokens: 2400 });
    const audit = RedesignQualityAuditSchema.parse(extractJson(raw));
    return {
      ok: audit.pass && audit.redesign_score >= 7 && audit.redesign_score >= audit.original_score + 1,
      originalScreenshotUrl,
      candidateScreenshotUrl,
      audit,
    };
  } catch (err) {
    logger.warn({ prospectId: input.prospect.id, err: String(err) }, "redesign quality audit failed");
    return {
      ok: false,
      originalScreenshotUrl,
      candidateScreenshotUrl,
      audit: {
        pass: false,
        original_score: 0,
        redesign_score: 0,
        delta: 0,
        verdict: "Quality audit failed to parse, so the preview is not safe to ship.",
        fatal_issues: ["Quality audit failed"],
        better_than_original: [],
        repair_instruction: "Regenerate with a conservative, polished mobile layout. Prioritize readability, spacing, trust, and a clean above-the-fold CTA over experimentation.",
      },
    };
  }
}
