import { deployments, type DbClient, type Prospect, type VerticalTemplate } from "@super-engine/db";
import { REDESIGN_PROMPT_V1_1 } from "@super-engine/prompts";
import { claudeText } from "../integrations/claude.js";
import { deployStaticHtml } from "../integrations/vercel.js";
import { pickVariant } from "../lib/variants.js";
import { env } from "../lib/env.js";
import { transition } from "./transitions.js";
import { getOrCreateTemplate } from "./template.js";
import { RejectProspectError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

function validateHtml(html: string): { ok: true } | { ok: false; reason: string } {
  if (!/<!doctype html>/i.test(html)) return { ok: false, reason: "missing_doctype" };
  if (!/<html[\s>]/i.test(html)) return { ok: false, reason: "missing_html_tag" };
  if (!/<style[\s>]/i.test(html)) return { ok: false, reason: "missing_style_tag" };
  if (!/<section\s+id=["']book["']/i.test(html)) return { ok: false, reason: "missing_book_section" };
  // All href="#..." anchors must resolve to an id present in the document
  const anchorTargets = [...html.matchAll(/href\s*=\s*["']#([^"']+)["']/gi)].map((m) => m[1]!);
  const idSet = new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!));
  for (const t of anchorTargets) {
    if (!idSet.has(t)) return { ok: false, reason: `anchor_missing:#${t}` };
  }
  if (html.length < 3000) return { ok: false, reason: "html_too_short" };
  return { ok: true };
}

function cleanGeneratedHtml(raw: string): string {
  // Strip any leading prose or markdown fences
  const doctypeIdx = raw.search(/<!doctype html>/i);
  const fromDoctype = doctypeIdx >= 0 ? raw.slice(doctypeIdx) : raw;
  return fromDoctype.replace(/```html\s*/i, "").replace(/```\s*$/i, "").trim();
}

export async function redesignProspect(db: DbClient, prospect: Prospect): Promise<void> {
  const template: VerticalTemplate = await getOrCreateTemplate(db, prospect.niche);
  const variant = pickVariant(prospect.id);
  const cfg = env();

  const years =
    prospect.detectedYear && prospect.detectedYear > 1990
      ? `Since ${prospect.detectedYear}`
      : "Established local business";

  const pagesMeta = (prospect.scrapedPages as Array<{ url: string; title: string; length: number }> | null) ?? [];
  const pagesSummary = pagesMeta.length
    ? pagesMeta.map((p) => `${p.url} (${p.length} chars)`).join("; ")
    : "(homepage only)";

  const prompt = REDESIGN_PROMPT_V1_1.render({
    name: prospect.businessName,
    niche: prospect.niche,
    city: prospect.city ?? "",
    scraped_services: prospect.scrapedServices ?? [],
    scraped_copy: prospect.scrapedCopy ?? "",
    scraped_about_copy: prospect.scrapedAboutCopy ?? "",
    scraped_testimonials: prospect.scrapedTestimonials ?? [],
    scraped_pages_summary: pagesSummary,
    years,
    palette_json: JSON.stringify(variant.palette),
    fonts_json: JSON.stringify(variant.fonts),
    layout_name: variant.layout,
    template_primary_cta: template.primaryCta,
    template_secondary_cta: template.secondaryCta,
    template_tagline: template.tagline,
    template_hero_subtitle_style: template.heroSubtitleStyle,
    template_services: (template.services as Array<{ name: string; desc: string }>) ?? [],
    template_extra_section_title: template.extraSectionTitle ?? "",
    template_extra_section_items: (template.extraSectionItems as Array<{ heading: string; body: string }>) ?? [],
    operator_name: cfg.OPERATOR_NAME,
    operator_email: cfg.OPERATOR_EMAIL || "",
    operator_phone: cfg.OPERATOR_PHONE || "",
  });

  let html: string | null = null;
  let lastFailure: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await claudeText(prompt, { maxTokens: 8000 });
    const cleaned = cleanGeneratedHtml(raw);
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
    variantJson: { palette: variant.palette, fonts: variant.fonts, layout: variant.layout },
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
      variantPalette: variant.palette.name,
      variantFonts: variant.fonts.name,
      variantLayout: variant.layout,
    },
  });

  logger.info({ prospectId: prospect.id, url: deploy.url }, "redesign deployed");
}
