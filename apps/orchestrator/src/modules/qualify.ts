import { type DbClient, type Prospect } from "@super-engine/db";
import { QUALIFY_PROMPT_V1 } from "@super-engine/prompts";
import { QualifyResultSchema } from "@super-engine/schemas";
import { claudeVision, extractJson } from "../integrations/claude.js";
import { screenshot } from "../integrations/places.js";
import { RejectProspectError } from "../lib/errors.js";
import { transition } from "./transitions.js";
import { logger } from "../lib/logger.js";

const KNOWN_CHAINS = [
  "mcdonald",
  "starbucks",
  "subway",
  "dominos",
  "supercuts",
  "great clips",
  "sport clips",
  "costa coffee",
  "kfc",
  "burger king",
  "taco bell",
  "pizza hut",
];

function hasChainName(name: string): boolean {
  const n = name.toLowerCase();
  return KNOWN_CHAINS.some((c) => n.includes(c));
}

export async function qualifyProspect(db: DbClient, prospect: Prospect): Promise<void> {
  try {
    // Step 1: hard disqualifiers
    if (hasChainName(prospect.businessName)) {
      throw new RejectProspectError("franchise_risk", `Business name looks like a chain: ${prospect.businessName}`);
    }
    if (prospect.reviewCount !== null) {
      if (prospect.reviewCount < 20) {
        throw new RejectProspectError("low_review_volume", `Only ${prospect.reviewCount} reviews`);
      }
      if (prospect.reviewCount > 2000) {
        throw new RejectProspectError("chain_scale", `${prospect.reviewCount} reviews — likely a chain`);
      }
    }
    if (!prospect.website) {
      throw new RejectProspectError("no_website", "No website");
    }

    // Step 2: vision check
    const shotUrl = await screenshot(prospect.website).catch((e) => {
      logger.warn({ err: String(e), prospectId: prospect.id }, "screenshot failed");
      throw new RejectProspectError("screenshot_failed", String(e));
    });

    const prompt = QUALIFY_PROMPT_V1.render({
      name: prospect.businessName,
      niche: prospect.niche,
      city: prospect.city ?? "",
      rating: prospect.rating ? Number(prospect.rating) : null,
      review_count: prospect.reviewCount,
      detected_year: prospect.detectedYear,
    });

    const raw = await claudeVision(prompt, shotUrl);
    const parsed = QualifyResultSchema.parse(extractJson(raw));

    // Decision policy (merges spec §6.3 + visual score)
    const pass = parsed.pass && parsed.score <= 4.0 && parsed.score >= 1.0;

    if (!pass) {
      throw new RejectProspectError(
        "site_already_good",
        `Visual score ${parsed.score.toFixed(1)} — site does not need redesign`,
      );
    }

    await transition({
      db,
      prospectId: prospect.id,
      from: prospect.state as any,
      to: "QUALIFIED",
      reason: "qualified",
      patch: {
        screenshotUrl: shotUrl,
        qualificationScore: String(parsed.score),
        qualificationReasoning: parsed.reasoning,
        qualificationIssues: parsed.top_issues,
      },
    });
  } catch (err) {
    if (err instanceof RejectProspectError) {
      await transition({
        db,
        prospectId: prospect.id,
        from: prospect.state as any,
        to: "REJECTED",
        reason: err.reason,
        patch: { rejectionReason: err.reason, qualificationReasoning: err.message },
      });
      return;
    }
    throw err;
  }
}
