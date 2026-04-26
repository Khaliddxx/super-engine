import { type DbClient, type Prospect } from "@super-engine/db";
import { QUALIFY_PROMPT_V1 } from "@super-engine/prompts";
import { QualifyResultSchema } from "@super-engine/schemas";
import { claudeVision, extractJson } from "../integrations/claude.js";
import { screenshot } from "../integrations/places.js";
import { RejectProspectError } from "../lib/errors.js";
import { transition } from "./transitions.js";
import { analyzeSiteStrength } from "./site-strength.js";
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

    // Step 2: structural pre-check (cheap, no Claude/Microlink credits).
    //
    // If the site already has a booking engine, virtual tour, deep sitemap,
    // and a current copyright year, a one-page redesign would be WORSE than
    // what they have. We skip it rather than propose a downgrade.
    //
    // BUT: this is a NEW-prospect gate only. If the prospect already has a
    // working `redesignHtmlUrl`, the operator already triaged + approved this
    // site once. Don't re-kill them on regenerate paths.
    const alreadyHasRedesign = Boolean(prospect.redesignHtmlUrl);
    const strength = alreadyHasRedesign
      ? null
      : await analyzeSiteStrength(prospect.website).catch((e) => {
          logger.warn({ err: String(e), prospectId: prospect.id }, "site_strength analysis failed");
          return null;
        });
    if (strength?.strong) {
      logger.info(
        {
          prospectId: prospect.id,
          score: strength.score,
          reasons: strength.reasons,
          contentPages: strength.signals.contentPageCount,
        },
        "skipping: site already strong",
      );
      // Persist the signals before rejecting so the operator can see WHY.
      await transition({
        db,
        prospectId: prospect.id,
        from: prospect.state as any,
        to: "REJECTED",
        reason: "site_already_strong",
        patch: {
          rejectionReason: "site_already_strong",
          qualificationReasoning: strength.reasons.join("; "),
          qualificationIssues: ["already_modern", ...strength.reasons],
          siteStrengthScore: String(strength.score),
          siteStrengthSignals: strength.signals as any,
        },
      });
      return;
    }

    // Step 3: vision check (only for sites that passed the structural gate).
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

    // Regenerate path: a prospect that's already been approved once should NOT
    // be re-rejected by the visual gate just because the operator clicked
    // "retry". The operator owns that decision.
    if (!pass && !alreadyHasRedesign) {
      throw new RejectProspectError(
        "site_already_good",
        `Visual score ${parsed.score.toFixed(1)} — site does not need redesign`,
      );
    }
    if (!pass && alreadyHasRedesign) {
      logger.info(
        { prospectId: prospect.id, score: parsed.score },
        "vision gate would reject, but prospect already has redesignHtmlUrl — letting through",
      );
    }

    // Augment qualification issues with strength signals so the operator can
    // see (in the queue card) WHY the AI flagged it + what the existing site has.
    const enrichedIssues = [...parsed.top_issues];
    if (strength && strength.signals.sitemapPageCount > 0) {
      enrichedIssues.push(
        `Site has ${strength.signals.contentPageCount} content pages (sitemap), we'll only redesign if it's thin.`,
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
        qualificationIssues: enrichedIssues,
        siteStrengthScore: strength ? String(strength.score) : null,
        siteStrengthSignals: (strength?.signals as any) ?? null,
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
