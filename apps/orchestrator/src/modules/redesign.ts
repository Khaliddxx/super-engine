import { deployments, type DbClient, type Prospect, type VerticalTemplate } from "@super-engine/db";
import { REDESIGN_PROMPT_V2 } from "@super-engine/prompts";
import type { RedesignAssets } from "@super-engine/prompts";
import { claudeText } from "../integrations/claude.js";
import { deployStaticHtml } from "../integrations/vercel.js";
import { env } from "../lib/env.js";
import { transition } from "./transitions.js";
import { getOrCreateTemplate } from "./template.js";
import { RejectProspectError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

function stripDashes(html: string): string {
  // Replace em/en-dashes with commas in visible text only. We don't care about
  // matching HTML context perfectly — redesigns don't legitimately contain
  // em-dashes, so a blanket replace is safe.
  return html.replace(/[—–]/g, ", ");
}

function validateHtml(html: string): { ok: true } | { ok: false; reason: string } {
  if (!/<!doctype html>/i.test(html)) return { ok: false, reason: "missing_doctype" };
  if (!/<html[\s>]/i.test(html)) return { ok: false, reason: "missing_html_tag" };
  if (!/<style[\s>]/i.test(html)) return { ok: false, reason: "missing_style_tag" };
  if (!/<section\s+id=["']book["']/i.test(html)) return { ok: false, reason: "missing_book_section" };
  const anchorTargets = [...html.matchAll(/href\s*=\s*["']#([^"']+)["']/gi)].map((m) => m[1]!);
  const idSet = new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!));
  for (const t of anchorTargets) {
    if (!idSet.has(t)) return { ok: false, reason: `anchor_missing:#${t}` };
  }
  if (html.length < 5000) return { ok: false, reason: "html_too_short" };
  return { ok: true };
}

function cleanGeneratedHtml(raw: string): string {
  const doctypeIdx = raw.search(/<!doctype html>/i);
  const fromDoctype = doctypeIdx >= 0 ? raw.slice(doctypeIdx) : raw;
  return fromDoctype.replace(/```html\s*/i, "").replace(/```\s*$/i, "").trim();
}

function emptyAssets(): RedesignAssets {
  return {
    logo: null,
    heroImage: null,
    heroVideo: null,
    images: [],
    videos: [],
    ogImage: null,
    favicon: null,
    brandColors: [],
    brandFonts: [],
    socials: {},
  };
}

export async function redesignProspect(db: DbClient, prospect: Prospect): Promise<void> {
  const template: VerticalTemplate = await getOrCreateTemplate(db, prospect.niche);
  const cfg = env();

  const years =
    prospect.detectedYear && prospect.detectedYear > 1990
      ? `Since ${prospect.detectedYear}`
      : "Established local business";

  const pagesMeta = (prospect.scrapedPages as Array<{ url: string; title: string; length: number }> | null) ?? [];
  const pagesSummary = pagesMeta.length
    ? pagesMeta.map((p) => `${p.url} (${p.length} chars)`).join("; ")
    : "(homepage only)";

  const assets = (prospect.scrapedAssets as RedesignAssets | null) ?? emptyAssets();

  const prompt = REDESIGN_PROMPT_V2.render({
    name: prospect.businessName,
    niche: prospect.niche,
    city: prospect.city ?? "",
    scraped_services: prospect.scrapedServices ?? [],
    scraped_copy: prospect.scrapedCopy ?? "",
    scraped_about_copy: prospect.scrapedAboutCopy ?? "",
    scraped_testimonials: prospect.scrapedTestimonials ?? [],
    scraped_pages_summary: pagesSummary,
    assets,
    years,
    current_year: new Date().getFullYear(),
    template_primary_cta: template.primaryCta,
    template_secondary_cta: template.secondaryCta,
    template_tagline: template.tagline,
    template_services: (template.services as Array<{ name: string; desc: string }>) ?? [],
    operator_name: cfg.OPERATOR_NAME,
    operator_email: cfg.OPERATOR_EMAIL || "",
    operator_phone: cfg.OPERATOR_PHONE || "",
  });

  let html: string | null = null;
  let lastFailure: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await claudeText(prompt, { maxTokens: 16000, temperature: 0.4 });
    const cleaned = stripDashes(cleanGeneratedHtml(raw));
    const validation = validateHtml(cleaned);
    if (validation.ok) {
      html = cleaned;
      break;
    }
    lastFailure = validation.reason;
    logger.warn({ attempt, reason: validation.reason, prospectId: prospect.id }, "redesign validation failed");
  }

  if (!html) {
    await transition({
      db,
      prospectId: prospect.id,
      from: prospect.state as any,
      to: "REJECTED",
      reason: "html_validation_failed",
      patch: { rejectionReason: `html_validation_failed:${lastFailure ?? "unknown"}` },
    });
    throw new RejectProspectError("html_validation_failed", lastFailure ?? "unknown");
  }

  const deploy = await deployStaticHtml({
    html,
    businessName: prospect.businessName,
    prospectId: prospect.id,
  });

  await db.insert(deployments).values({
    prospectId: prospect.id,
    vercelDeploymentId: deploy.deploymentId,
    url: deploy.url,
    htmlContent: html,
    variantJson: {
      brandColors: assets.brandColors,
      brandFonts: assets.brandFonts,
      usedLogo: Boolean(assets.logo),
      usedHeroVideo: Boolean(assets.heroVideo),
      usedHeroImage: Boolean(assets.heroImage),
    },
  });

  await transition({
    db,
    prospectId: prospect.id,
    from: prospect.state as any,
    to: "REDESIGNED",
    reason: "redesigned",
    patch: {
      redesignHtmlUrl: deploy.url,
      redesignDeployedAt: new Date(),
      variantPalette: assets.brandColors[0] ?? "brand",
      variantFonts: assets.brandFonts[0] ?? "modern",
      variantLayout: assets.heroVideo ? "hero-video" : assets.heroImage ? "hero-image" : "brand",
    },
  });

  logger.info(
    {
      prospectId: prospect.id,
      url: deploy.url,
      usedLogo: Boolean(assets.logo),
      images: assets.images.length,
    },
    "redesign deployed",
  );
}
