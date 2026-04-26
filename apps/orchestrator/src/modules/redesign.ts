import { deployments, type DbClient, type Prospect, type VerticalTemplate } from "@super-engine/db";
import { REDESIGN_PROMPT_V2, type RedesignAssets, type RedesignSitemapEntry } from "@super-engine/prompts";
import { claudeText } from "../integrations/claude.js";
import { deployStaticSite, type StaticSiteFile } from "../integrations/vercel.js";
import { env } from "../lib/env.js";
import { transition } from "./transitions.js";
import { getOrCreateTemplate } from "./template.js";
import { pickArchetype } from "./archetypes.js";
import { checkRedesignQuality } from "./redesign-quality.js";
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

export interface StudioOverlayArgs {
  displayName: string;
  tagline: string;
  bookingUrl: string;
  businessName: string;
  /** When `bookingUrl` is empty, used for the CTA so the button is not dead. */
  fallbackMailto?: string;
  prospectId: string;
  /** Super Engine PWA origin (no path). If unset, "Edit with AI" is disabled in the banner. */
  pwaAppUrl?: string;
}

/** Prevent tagline/display name from breaking overlay DOM or XSS. */
function escapeStudioHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildStudioOverlay(a: StudioOverlayArgs): string {
  const displayName = escapeStudioHtml(a.displayName ?? "");
  const tagline = escapeStudioHtml(a.tagline ?? "");
  const booking = (a.bookingUrl ?? "").trim();
  const mail = (a.fallbackMailto ?? "").trim();
  const hasBooking = Boolean(booking);
  const hasMail = Boolean(mail);
  const ctaHref = hasBooking
    ? booking.replace(/"/g, "&quot;")
    : hasMail
      ? mail.replace(/"/g, "&quot;")
      : "";
  const ctaInner = `Book a 15-min call
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;
  const ctaBlock = hasBooking
    ? `<a class="se-studio-cta" href="${ctaHref}" target="_blank" rel="noopener">
      ${ctaInner}
    </a>`
    : hasMail
      ? `<a class="se-studio-cta" href="${ctaHref}">
      ${ctaInner}
    </a>`
      : `<span class="se-studio-cta se-studio-cta--inactive" title="Set STUDIO_BOOKING_URL or OPERATOR_EMAIL in the studio environment">
      ${ctaInner}
    </span>`;

  const base = (a.pwaAppUrl ?? "").replace(/\/+$/, "");
  const pid = (a.prospectId ?? "").trim();
  const editAiBlock =
    base && pid
      ? `<a class="se-studio-cta se-studio-cta--ghost" href="${base.replace(/"/g, "&quot;")}/pipeline/${pid.replace(/"/g, "")}/preview" target="_blank" rel="noopener">
      Edit with AI
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z"/></svg>
    </a>`
      : `<span class="se-studio-cta se-studio-cta--ghost se-studio-cta--inactive" title="Set PWA_APP_URL on the orchestrator so Edit with AI can open your Super Engine portal">
      Edit with AI
    </span>`;

  return `
<!-- studio overlay (injected by Super Engine, not part of the business's content) -->
<div id="__se-studio-banner" role="complementary" aria-label="${displayName} — concept preview">
  <div class="se-studio-banner-card">
    <div class="se-studio-banner-body">
      <div class="se-studio-banner-eyebrow">${displayName}</div>
      <div class="se-studio-banner-copy">${tagline}</div>
    </div>
    <div class="se-studio-cta-group">
      ${ctaBlock}
      ${editAiBlock}
    </div>
    <button type="button" class="se-studio-close" aria-label="Dismiss" onclick="document.getElementById('__se-studio-banner').remove()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
    </button>
  </div>
</div>
<style>
  #__se-studio-banner {
    position: fixed !important;
    bottom: 16px !important;
    left: 16px !important;
    right: 16px !important;
    z-index: 2147483647 !important;
    font-family: ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif !important;
    pointer-events: none !important;
    display: block !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
  }
  #__se-studio-banner * { box-sizing: border-box !important; }
  #__se-studio-banner .se-studio-banner-card {
    pointer-events: auto !important;
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    gap: 10px !important;
    max-width: 620px !important;
    margin: 0 auto !important;
    padding: 10px 10px 10px 14px !important;
    background: #0b0d12 !important;
    color: #e7ebf0 !important;
    border: 1px solid rgba(255,255,255,0.08) !important;
    border-radius: 14px !important;
    box-shadow: 0 14px 40px rgba(0,0,0,0.28) !important;
    backdrop-filter: saturate(120%) blur(8px) !important;
    -webkit-backdrop-filter: saturate(120%) blur(8px) !important;
  }
  #__se-studio-banner .se-studio-banner-body {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    display: block !important;
  }
  #__se-studio-banner .se-studio-banner-eyebrow {
    display: block !important;
    font-size: 11px !important;
    letter-spacing: 0.08em !important;
    text-transform: uppercase !important;
    color: #8892a6 !important;
    margin: 0 0 2px 0 !important;
    line-height: 1.3 !important;
  }
  #__se-studio-banner .se-studio-banner-copy {
    display: block !important;
    font-size: 13px !important;
    line-height: 1.35 !important;
    color: #e7ebf0 !important;
    margin: 0 !important;
  }
  #__se-studio-banner .se-studio-cta {
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    flex-shrink: 0 !important;
    padding: 10px 14px !important;
    min-height: 40px !important;
    background: #ffffff !important;
    color: #0b0d12 !important;
    border-radius: 10px !important;
    font-weight: 600 !important;
    font-size: 13px !important;
    letter-spacing: -0.01em !important;
    text-decoration: none !important;
    white-space: nowrap !important;
    border: none !important;
    cursor: pointer !important;
  }
  #__se-studio-banner .se-studio-cta:hover { background: #f1f3f5 !important; }
  #__se-studio-banner .se-studio-cta-group {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: wrap !important;
    gap: 8px !important;
    align-items: center !important;
    flex-shrink: 0 !important;
  }
  #__se-studio-banner .se-studio-cta--ghost {
    background: transparent !important;
    color: #e7ebf0 !important;
    border: 1px solid rgba(255,255,255,0.22) !important;
  }
  #__se-studio-banner .se-studio-cta--ghost:hover {
    background: rgba(255,255,255,0.06) !important;
    border-color: rgba(255,255,255,0.35) !important;
  }
  #__se-studio-banner .se-studio-cta--ghost.se-studio-cta--inactive:hover {
    background: transparent !important;
    border-color: rgba(255,255,255,0.22) !important;
  }
  #__se-studio-banner .se-studio-cta--inactive {
    opacity: 0.55 !important;
    cursor: not-allowed !important;
    pointer-events: none !important;
    background: #3d4450 !important;
    color: #c5ccd6 !important;
  }
  #__se-studio-banner .se-studio-close {
    flex-shrink: 0 !important;
    width: 32px !important;
    height: 32px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: transparent !important;
    color: #8892a6 !important;
    border: 0 !important;
    border-radius: 8px !important;
    cursor: pointer !important;
    padding: 0 !important;
  }
  #__se-studio-banner .se-studio-close:hover { color: #e7ebf0 !important; background: rgba(255,255,255,0.06) !important; }
  @media (max-width: 540px) {
    #__se-studio-banner .se-studio-banner-card { padding: 10px !important; gap: 8px !important; flex-wrap: wrap !important; }
    #__se-studio-banner .se-studio-banner-copy { font-size: 12px !important; }
    #__se-studio-banner .se-studio-cta { padding: 8px 10px !important; font-size: 12px !important; min-height: 36px !important; }
  }
  body { padding-bottom: 120px; }
</style>
`;
}

/**
 * Removes a previously injected studio banner (any version) so deploys always
 * pick up the current WellPlan.io template and env copy.
 */
export function stripStudioOverlay(html: string): string {
  return html.replace(
    /(?:<!--\s*studio overlay[\s\S]*?-->\s*)?<div\s+id=["']__se-studio-banner["'][^>]*>[\s\S]*?<\/div>\s*<style>[\s\S]*?#__se-studio-banner[\s\S]*?<\/style>\s*/gi,
    "",
  );
}

export function injectOverlay(html: string, overlayHtml: string): string {
  const h = stripStudioOverlay(html);
  if (/<\/body>/i.test(h)) return h.replace(/<\/body>/i, `${overlayHtml}\n</body>`);
  return `${h}\n${overlayHtml}`;
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
  const opEmail = (cfg.OPERATOR_EMAIL ?? "").trim();
  const overlay = buildStudioOverlay({
    displayName: cfg.STUDIO_DISPLAY_NAME,
    tagline: cfg.STUDIO_TAGLINE,
    bookingUrl: (cfg.STUDIO_BOOKING_URL as string | undefined) || "",
    businessName: prospect.businessName,
    fallbackMailto:
      opEmail && opEmail.includes("@")
        ? `mailto:${opEmail}?subject=${encodeURIComponent("Book a 15-min call")}`
        : undefined,
    prospectId: prospect.id,
    pwaAppUrl: (cfg.PWA_APP_URL ?? "").trim() || undefined,
  });

  let files: StaticSiteFile[] = [];
  let validatedSlugs: string[] = [];

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
  //  Visual quality gate
  // ─────────────────────────────────────────────
  //
  // Do NOT deploy straight to the public clean URL. A bad regenerate would
  // overwrite the project's production alias and make the stored preview worse
  // even if we later decide not to save it. Instead:
  //   1. Deploy the candidate to a throwaway QA project.
  //   2. Screenshot the original + candidate on mobile.
  //   3. Let Claude Vision compare them with a strict "must be clearly better"
  //      rubric.
  //   4. Only then deploy the accepted files to the clean public project.
  let qaDeploy = await deployStaticSite({
    files,
    businessName: prospect.businessName,
    prospectId: prospect.id,
    projectNameSuffix: `qa-${Date.now().toString(36)}`,
  });

  let quality = await checkRedesignQuality({
    prospect,
    candidateUrl: qaDeploy.url,
  });

  if (!quality.ok && quality.audit?.repair_instruction) {
    logger.warn(
      {
        prospectId: prospect.id,
        qaUrl: qaDeploy.url,
        audit: quality.audit,
      },
      "redesign failed first quality gate; attempting repair",
    );

    const repairPrompt = `${prompt}

<quality_repair_instruction priority="HIGHEST">
Your previous attempt failed the visual QA gate against the original mobile site.
Do not make a small cosmetic change. Rework the design so it is plainly more
credible, readable, and conversion-ready than the original.

QA verdict: ${quality.audit.verdict}
Fatal issues:
${quality.audit.fatal_issues.map((issue) => `- ${issue}`).join("\n") || "- (none)"}

Repair instruction:
${quality.audit.repair_instruction}
</quality_repair_instruction>

Return ONLY the JSON object, beginning with {.`; 

    const raw = await claudeText(repairPrompt, { maxTokens: 20000, temperature: 0.72 });
    const repairedPages = parseClaudeOutput(raw);
    if (repairedPages?.length) {
      const repairedBySlug = new Map<string, string>();
      for (const p of repairedPages) {
        const normSlug = p.slug.endsWith(".html") ? p.slug : `${p.slug}.html`;
        if (validSlugs.has(normSlug)) repairedBySlug.set(normSlug, p.html);
      }
      if (!repairedBySlug.has("index.html") && repairedPages[0]) {
        repairedBySlug.set("index.html", repairedPages[0].html);
      }

      const repairedFiles: StaticSiteFile[] = [];
      const repairedSlugs: string[] = [];
      for (const slug of sitemap.map((s) => s.slug)) {
        const rawPage = repairedBySlug.get(slug);
        if (!rawPage) continue;
        let cleaned = stripDashes(rawPage);
        cleaned = stripOutboundToBusinessDomain(cleaned, businessHost);
        cleaned = rewriteSiblingNav(cleaned, validSlugs);
        cleaned = fixAnchorTargets(cleaned);
        cleaned = markActiveNav(cleaned, slug);
        cleaned = injectOverlay(cleaned, overlay);

        const v = validatePage(cleaned);
        if (!v.ok) {
          logger.warn({ slug, reason: v.reason, prospectId: prospect.id }, "repaired page validation failed, skipping");
          continue;
        }
        repairedFiles.push({ file: slug, data: cleaned });
        repairedSlugs.push(slug);
      }

      if (repairedFiles.some((f) => f.file === "index.html")) {
        const repairedQaDeploy = await deployStaticSite({
          files: repairedFiles,
          businessName: prospect.businessName,
          prospectId: prospect.id,
          projectNameSuffix: `qa-repair-${Date.now().toString(36)}`,
        });
        const repairedQuality = await checkRedesignQuality({
          prospect,
          candidateUrl: repairedQaDeploy.url,
        });
        if (repairedQuality.ok) {
          files = repairedFiles;
          validatedSlugs = repairedSlugs;
          qaDeploy = repairedQaDeploy;
          quality = repairedQuality;
        } else {
          quality = repairedQuality;
          qaDeploy = repairedQaDeploy;
        }
      }
    }
  }

  if (!quality.ok) {
    logger.warn(
      {
        prospectId: prospect.id,
        qaUrl: qaDeploy.url,
        audit: quality.audit,
      },
      "redesign failed quality gate; keeping previous preview",
    );
    const verdict = quality.audit?.verdict ?? "candidate was not clearly better than original";
    const repair = quality.audit?.repair_instruction ?? "";
    await handleRedesignFailure(db, prospect, `quality_gate_failed:${verdict}${repair ? ` | ${repair}` : ""}`.slice(0, 420));
    return;
  }

  // ─────────────────────────────────────────────
  //  Deploy accepted preview
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
      qualityGate: {
        promptVersion: "1.0",
        qaUrl: qaDeploy.url,
        originalScreenshotUrl: quality.originalScreenshotUrl,
        candidateScreenshotUrl: quality.candidateScreenshotUrl,
        audit: quality.audit,
      },
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
