import { deployments, type DbClient, type Prospect, type VerticalTemplate } from "@super-engine/db";
import { REDESIGN_PROMPT_V2, type RedesignAssets, type RedesignSitemapEntry } from "@super-engine/prompts";
import { claudeText } from "../integrations/claude.js";
import { deployStaticSite, type StaticSiteFile } from "../integrations/vercel.js";
import { env } from "../lib/env.js";
import { transition } from "./transitions.js";
import { getOrCreateTemplate } from "./template.js";
import { pickArchetype } from "./archetypes.js";
import { logger } from "../lib/logger.js";

// ─────────────────────────────────────────────
//  Helpers — cleanup + validation
// ─────────────────────────────────────────────

function stripDashes(html: string): string {
  return html.replace(/[—–]/g, ", ");
}

function cleanGeneratedJson(raw: string): string {
  const trimmed = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const braceIdx = trimmed.indexOf("{");
  if (braceIdx > 0) return trimmed.slice(braceIdx);
  return trimmed;
}

interface ClaudePage {
  slug: string;
  html: string;
}

/**
 * Try to extract one or more pages from Claude's response. Falls through several
 * recovery layers so a slightly malformed response NEVER causes a hard rejection.
 */
function parseClaudeOutput(raw: string): ClaudePage[] | null {
  // Layer 1 — clean JSON
  const cleaned = cleanGeneratedJson(raw);
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.pages)) {
      const pages = (parsed.pages as any[])
        .filter((p) => p && typeof p.slug === "string" && typeof p.html === "string")
        .map((p) => ({ slug: String(p.slug), html: String(p.html) }));
      if (pages.length) return pages;
    }
    if (Array.isArray(parsed)) {
      const pages = parsed
        .filter((p) => p && typeof p.slug === "string" && typeof p.html === "string")
        .map((p) => ({ slug: String(p.slug), html: String(p.html) }));
      if (pages.length) return pages;
    }
  } catch {
    // fall through
  }

  // Layer 2 — JSON looks like it was truncated mid-string. Pull out every
  // valid `{ "slug": "...", "html": "<!DOCTYPE..." }` block we can find.
  const blockPages: ClaudePage[] = [];
  const blockRe = /"slug"\s*:\s*"([^"]+)"\s*,\s*"html"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"|}\s*[,\]])/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(cleaned)) !== null) {
    const slug = m[1]!;
    // Unescape JSON string content
    const html = m[2]!
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">");
    if (/<!doctype html>/i.test(html)) blockPages.push({ slug, html });
  }
  if (blockPages.length) return blockPages;

  // Layer 3 — model returned raw HTML despite being asked for JSON.
  const doctypeIdx = raw.search(/<!doctype html>/i);
  if (doctypeIdx >= 0) {
    const html = raw.slice(doctypeIdx).trim();
    return [{ slug: "index.html", html }];
  }

  return null;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Rewrite any <a href> that points to the business's live domain → contact.html#book. */
function stripOutboundToBusinessDomain(html: string, businessHost: string | null): string {
  if (!businessHost) return html;
  const hostRe = new RegExp(`href\\s*=\\s*(["'])((?:https?:)?//(?:www\\.)?${businessHost.replace(/\./g, "\\.")}[^"']*)\\1`, "gi");
  return html.replace(hostRe, 'href="contact.html#book"');
}

/** Replace dead #anchor targets (pointing to ids that don't exist on THIS page) with #book or omit. */
function fixAnchorTargets(html: string): string {
  const idSet = new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!));
  return html.replace(/href\s*=\s*(["'])#([^"'\s]+)\1/gi, (_m, q, id) => {
    if (idSet.has(id)) return `href=${q}#${id}${q}`;
    if (idSet.has("book")) return `href=${q}#book${q}`;
    if (idSet.has("contact")) return `href=${q}#contact${q}`;
    // No safe in-page target — make it a no-op link
    return `href=${q}#${q}`;
  });
}

/** Ensure sibling-page links point to real slugs we're about to deploy. */
function rewriteSiblingNav(html: string, validSlugs: Set<string>): string {
  // Normalize "/index.html", "index", "home" → index.html
  // For anything else "/about.html" → "about.html"
  return html.replace(/href\s*=\s*(["'])\/?(?!https?:|mailto:|tel:|#)([^"'\s]+)\1/gi, (full, q, target) => {
    const normalized = target.replace(/^\/+/, "").split("?")[0]!.split("#")[0]!;
    // Keep fragment & query for post-processing
    const trailing = target.slice(normalized.length);

    // Already correct
    if (validSlugs.has(normalized)) return `href=${q}${normalized}${trailing}${q}`;
    // Common Claude mistakes: "home" → index.html, "about" → about.html, etc
    const candidate = `${normalized.replace(/\.html?$/, "")}.html`;
    if (validSlugs.has(candidate)) return `href=${q}${candidate}${trailing}${q}`;
    if (normalized === "home" || normalized === "" || normalized === "index") {
      return `href=${q}index.html${trailing}${q}`;
    }
    // External path we don't know → point to index.html
    return `href=${q}index.html${q}`;
  });
}

/** Mark the current page's nav link with aria-current="page" for the active state. */
function markActiveNav(html: string, currentSlug: string): string {
  const slugPatterns = [currentSlug, currentSlug.replace(/\.html$/, "")];
  for (const s of slugPatterns) {
    const re = new RegExp(`(<a\\s+[^>]*href\\s*=\\s*["']${s.replace(/\./g, "\\.")}["'][^>]*)(>)`, "i");
    if (re.test(html)) {
      return html.replace(re, (_m, start, close) => {
        if (/aria-current/i.test(start)) return `${start}${close}`;
        return `${start} aria-current="page"${close}`;
      });
    }
  }
  return html;
}

interface StudioOverlayArgs {
  displayName: string;
  tagline: string;
  bookingUrl: string;
  businessName: string;
}

function buildStudioOverlay(a: StudioOverlayArgs): string {
  const hasBooking = Boolean(a.bookingUrl);
  const ctaAttrs = hasBooking
    ? `href="${a.bookingUrl}" target="_blank" rel="noopener"`
    : `href="#" onclick="return false"`;
  return `
<!-- studio overlay (injected by Super Engine, not part of the business's content) -->
<div id="__se-studio-banner" role="complementary" aria-label="Message from the designer">
  <div class="__se-card">
    <div class="__se-body">
      <div class="__se-eyebrow">${a.displayName}</div>
      <div class="__se-copy">${a.tagline}</div>
    </div>
    <a class="__se-cta" ${ctaAttrs}>
      Book a 15-min call
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
    </a>
    <button class="__se-close" aria-label="Dismiss" onclick="document.getElementById('__se-studio-banner').remove()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
    </button>
  </div>
</div>
<style>
  #__se-studio-banner {
    position: fixed; bottom: 16px; left: 16px; right: 16px; z-index: 2147483647;
    font-family: ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    pointer-events: none;
  }
  #__se-studio-banner .__se-card {
    pointer-events: auto;
    display: flex; align-items: center; gap: 10px;
    max-width: 620px; margin: 0 auto;
    padding: 10px 10px 10px 14px;
    background: #0b0d12; color: #e7ebf0;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    box-shadow: 0 14px 40px rgba(0,0,0,0.28);
    backdrop-filter: saturate(120%) blur(8px);
    -webkit-backdrop-filter: saturate(120%) blur(8px);
  }
  #__se-studio-banner .__se-body { flex: 1; min-width: 0; }
  #__se-studio-banner .__se-eyebrow {
    font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
    color: #8892a6; margin-bottom: 2px;
  }
  #__se-studio-banner .__se-copy {
    font-size: 13px; line-height: 1.35; color: #e7ebf0;
    overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  #__se-studio-banner .__se-cta {
    display: inline-flex; align-items: center; gap: 6px;
    flex-shrink: 0; padding: 10px 14px; min-height: 40px;
    background: #ffffff; color: #0b0d12;
    border-radius: 10px; font-weight: 600; font-size: 13px; letter-spacing: -0.01em;
    text-decoration: none; white-space: nowrap;
  }
  #__se-studio-banner .__se-cta:hover { background: #f1f3f5; }
  #__se-studio-banner .__se-close {
    flex-shrink: 0; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
    background: transparent; color: #8892a6; border: 0; border-radius: 8px; cursor: pointer;
  }
  #__se-studio-banner .__se-close:hover { color: #e7ebf0; background: rgba(255,255,255,0.06); }
  @media (max-width: 540px) {
    #__se-studio-banner .__se-card { padding: 10px; gap: 8px; }
    #__se-studio-banner .__se-copy { font-size: 12px; }
    #__se-studio-banner .__se-cta { padding: 8px 10px; font-size: 12px; min-height: 36px; }
  }
  body { padding-bottom: 120px; }
</style>
`;
}

function injectOverlay(html: string, overlayHtml: string): string {
  if (/__se-studio-banner/.test(html)) return html; // already present
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${overlayHtml}\n</body>`);
  return `${html}\n${overlayHtml}`;
}

function validatePage(html: string): { ok: true } | { ok: false; reason: string } {
  if (!/<!doctype html>/i.test(html)) return { ok: false, reason: "missing_doctype" };
  if (!/<html[\s>]/i.test(html)) return { ok: false, reason: "missing_html_tag" };
  if (!/<style[\s>]/i.test(html)) return { ok: false, reason: "missing_style_tag" };
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) return { ok: false, reason: "missing_viewport" };
  if (html.length < 2500) return { ok: false, reason: "html_too_short" };
  return { ok: true };
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

// ─────────────────────────────────────────────
//  Sitemap selection
// ─────────────────────────────────────────────

interface DbSitemapEntry {
  slug: string;
  type: string;
  title: string;
  snippet: string;
  sourceUrl: string;
}

/**
 * Pick the sitemap to generate.
 *
 * IMPORTANT: we cap at 3 pages by default. With Claude returning JSON, more
 * than 3 pages × ~3500 chars hits the token cap and produces truncated JSON
 * that we can't recover from cleanly. 3 pages is the sweet spot: enough to
 * feel like a real site (home + about/menu/services + contact), small enough
 * that Claude can finish.
 */
const MAX_PAGES = 3;

function selectSitemap(prospect: Prospect): RedesignSitemapEntry[] {
  const stored = (prospect.scrapedSitemap as DbSitemapEntry[] | null) ?? [];

  const home: RedesignSitemapEntry = stored.find((s) => s.slug === "index.html") ?? {
    slug: "index.html",
    type: "home",
    title: prospect.businessName,
    snippet: prospect.scrapedCopy ?? "",
    sourceUrl: prospect.website ?? "",
  };
  const contact: RedesignSitemapEntry = stored.find((s) => s.slug === "contact.html") ?? {
    slug: "contact.html",
    type: "contact",
    title: "Contact",
    snippet: prospect.phone ?? prospect.email ?? "",
    sourceUrl: prospect.website ?? "",
  };

  // Pick the most informative middle page from the stored sitemap.
  const middlePriority: string[] = ["menu.html", "rooms.html", "services.html", "about.html", "gallery.html", "team.html"];
  const middle =
    middlePriority
      .map((slug) => stored.find((s) => s.slug === slug))
      .find((entry): entry is DbSitemapEntry => Boolean(entry)) ??
    ({
      slug: "about.html",
      type: "about",
      title: "About",
      snippet: prospect.scrapedAboutCopy ?? "",
      sourceUrl: prospect.website ?? "",
    } satisfies RedesignSitemapEntry);

  return [home, middle, contact].slice(0, MAX_PAGES);
}

// ─────────────────────────────────────────────
//  Soft-failure handling
// ─────────────────────────────────────────────

/**
 * Centralized failure handler for the redesign step.
 *
 * Hard rule: if the prospect ALREADY has a working `redesignHtmlUrl`, we never
 * push them back to REJECTED. The original preview is still live; the operator
 * shouldn't lose data because a regen attempt produced bad HTML. We bring them
 * back to REDESIGNED instead and log the failure for inspection.
 *
 * Only when there is no prior preview do we transition to REJECTED, and even
 * then we use a clear `redesign_generation_failed` reason.
 */
async function handleRedesignFailure(db: DbClient, prospect: Prospect, reason: string): Promise<void> {
  const hasPreviousPreview = Boolean(prospect.redesignHtmlUrl);

  if (hasPreviousPreview) {
    logger.warn(
      { prospectId: prospect.id, reason, keepingUrl: prospect.redesignHtmlUrl },
      "redesign regen failed; restoring REDESIGNED state with previous preview",
    );
    await transition({
      db,
      prospectId: prospect.id,
      from: prospect.state as any,
      to: "REDESIGNED",
      reason: `regen_failed_kept_previous:${reason}`,
      patch: {
        // explicit: keep redesignHtmlUrl + redesignDeployedAt as-is
        rejectionReason: null,
      },
    });
    return;
  }

  logger.error({ prospectId: prospect.id, reason }, "redesign generation failed (no previous preview)");
  await transition({
    db,
    prospectId: prospect.id,
    from: prospect.state as any,
    to: "REJECTED",
    reason: "redesign_generation_failed",
    patch: { rejectionReason: `redesign_generation_failed:${reason}` },
  });
}

// ─────────────────────────────────────────────
//  Main entry
// ─────────────────────────────────────────────

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
  const sitemap = selectSitemap(prospect);
  const validSlugs = new Set(sitemap.map((s) => s.slug));

  const businessHost = hostOf(prospect.website);

  const archetype = pickArchetype(prospect.id);
  logger.info(
    { prospectId: prospect.id, archetype: archetype.id, hasOperatorInstruction: Boolean(prospect.redesignInstruction) },
    "redesign creative direction selected",
  );

  const prompt = REDESIGN_PROMPT_V2.render({
    name: prospect.businessName,
    niche: prospect.niche,
    city: prospect.city ?? "",
    scraped_services: prospect.scrapedServices ?? [],
    scraped_copy: prospect.scrapedCopy ?? "",
    scraped_about_copy: prospect.scrapedAboutCopy ?? "",
    scraped_testimonials: prospect.scrapedTestimonials ?? [],
    scraped_pages_summary: pagesSummary,
    sitemap,
    assets,
    years,
    current_year: new Date().getFullYear(),
    archetype,
    operator_instruction: prospect.redesignInstruction ?? null,
    fallback_primary_cta: template.primaryCta,
    fallback_secondary_cta: template.secondaryCta,
    fallback_tagline: template.tagline,
    fallback_services: (template.services as Array<{ name: string; desc: string }>) ?? [],
    business_contact: {
      phone: prospect.phone ?? null,
      email: prospect.email ?? null,
      address: prospect.city ?? null,
      bookingUrl: null, // reserved — detected booking URL extraction lives in a later iteration
    },
  });

  // ─────────────────────────────────────────────
  //  Generate (up to 2 attempts)
  // ─────────────────────────────────────────────
  let pages: ClaudePage[] | null = null;
  let lastFailure: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Higher temp on retry so the second attempt explores a different visual
    // path — fixes the "every regenerate looks the same" complaint.
    const temperature = attempt === 1 ? 0.85 : 1.0;
    const raw = await claudeText(prompt, { maxTokens: 20000, temperature });
    const parsed = parseClaudeOutput(raw);
    if (parsed && parsed.length > 0) {
      pages = parsed;
      break;
    }
    lastFailure = "parse_failed";
    logger.warn({ attempt, prospectId: prospect.id, raw_head: raw.slice(0, 240) }, "redesign output parse failed");
  }

  if (!pages || pages.length === 0) {
    await handleRedesignFailure(db, prospect, `parse_failed:${lastFailure ?? "unknown"}`);
    return;
  }

  // ─────────────────────────────────────────────
  //  Normalize slugs + fill missing pages with a minimal shell
  // ─────────────────────────────────────────────
  const pagesBySlug = new Map<string, string>();
  for (const p of pages) {
    const normSlug = p.slug.endsWith(".html") ? p.slug : `${p.slug}.html`;
    if (validSlugs.has(normSlug)) {
      pagesBySlug.set(normSlug, p.html);
    }
  }
  // If Claude returned extra slugs or missed slugs, try to auto-map: first page => index
  if (!pagesBySlug.has("index.html") && pages[0]) {
    pagesBySlug.set("index.html", pages[0].html);
  }

  // ─────────────────────────────────────────────
  //  Clean + validate every page, inject overlay
  // ─────────────────────────────────────────────
  const overlay = buildStudioOverlay({
    displayName: cfg.STUDIO_DISPLAY_NAME,
    tagline: cfg.STUDIO_TAGLINE,
    bookingUrl: (cfg.STUDIO_BOOKING_URL as string | undefined) || "",
    businessName: prospect.businessName,
  });

  const files: StaticSiteFile[] = [];
  const validatedSlugs: string[] = [];

  for (const slug of sitemap.map((s) => s.slug)) {
    const raw = pagesBySlug.get(slug);
    if (!raw) continue;
    let cleaned = stripDashes(raw);
    cleaned = stripOutboundToBusinessDomain(cleaned, businessHost);
    cleaned = rewriteSiblingNav(cleaned, validSlugs);
    cleaned = fixAnchorTargets(cleaned);
    cleaned = markActiveNav(cleaned, slug);
    cleaned = injectOverlay(cleaned, overlay);

    const v = validatePage(cleaned);
    if (!v.ok) {
      logger.warn({ slug, reason: v.reason, prospectId: prospect.id }, "page validation failed, skipping");
      continue;
    }
    files.push({ file: slug, data: cleaned });
    validatedSlugs.push(slug);
  }

  const hasIndex = files.some((f) => f.file === "index.html");
  if (!hasIndex) {
    await handleRedesignFailure(db, prospect, "no_valid_index_page");
    return;
  }

  // ─────────────────────────────────────────────
  //  Deploy
  // ─────────────────────────────────────────────
  const deploy = await deployStaticSite({
    files,
    businessName: prospect.businessName,
    prospectId: prospect.id,
  });

  await db.insert(deployments).values({
    prospectId: prospect.id,
    vercelDeploymentId: deploy.deploymentId,
    url: deploy.url,
    htmlContent: files.find((f) => f.file === "index.html")?.data ?? "",
    variantJson: {
      brandColors: assets.brandColors,
      brandFonts: assets.brandFonts,
      usedLogo: Boolean(assets.logo),
      usedHeroVideo: Boolean(assets.heroVideo),
      usedHeroImage: Boolean(assets.heroImage),
      pageSlugs: validatedSlugs,
      promptVersion: REDESIGN_PROMPT_V2.version,
      archetypeId: archetype.id,
      operatorInstruction: prospect.redesignInstruction ?? null,
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
      pages: validatedSlugs,
      usedLogo: Boolean(assets.logo),
      images: assets.images.length,
      promptVersion: REDESIGN_PROMPT_V2.version,
    },
    "redesign deployed",
  );
}
