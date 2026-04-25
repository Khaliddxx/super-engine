/**
 * Cheap, pre-vision structural analysis of a prospect's website.
 *
 * Fetches the homepage HTML + sitemap.xml and scans for signals that the
 * site is already modern enough that a one-page redesign would be WORSE,
 * not better. If the score crosses a threshold the prospect is skipped
 * (reason: `site_already_strong`) before we spend a Microlink or Claude
 * credit on them.
 *
 * All checks are regex on raw HTML/XML — no cheerio, no Firecrawl — so
 * the whole pass is a couple of HTTP fetches (<1s normally).
 */

import { logger } from "../lib/logger.js";

const UA = "SuperEngineBot/1.0 (+https://super-engine.dev)";

export interface SiteStrengthSignals {
  sitemapPageCount: number;
  contentPageCount: number; // sitemap minus obvious policy/legal/blog-archive noise
  hasBookingEngine: boolean;
  hasImmersive: boolean; // matterport / 360 / virtual tour
  hasSchemaOrg: boolean;
  hasOgImage: boolean;
  hasViewport: boolean;
  hasManifest: boolean;
  hasPreloadedFont: boolean;
  hasModernCssGrid: boolean;
  copyrightYear: number | null;
  footerYearCurrent: boolean;
  detectedBookingDomains: string[];
  detectedImmersiveDomains: string[];
}

export interface SiteStrengthResult {
  score: number; // 0..10+
  strong: boolean; // score >= STRONG_THRESHOLD OR contentPageCount very high
  signals: SiteStrengthSignals;
  reasons: string[];
  scannedHomepageOk: boolean;
}

const STRONG_THRESHOLD = 4;
const HARD_PAGE_COUNT_SKIP = 8; // real content pages

const BOOKING_PATTERNS: Array<[string, RegExp]> = [
  ["resdiary", /resdiary\.com/i],
  ["opentable", /opentable\.(?:com|co)/i],
  ["resy", /resy\.com/i],
  ["sevenrooms", /sevenrooms\.com/i],
  ["tock", /\btock\.co\b/i],
  ["toasttab", /toasttab\.com/i],
  ["booking-embed", /booking\.com\/[a-z-]*\/widget/i],
  ["cloudbeds", /cloudbeds/i],
  ["dentally", /dentally\.(?:com|co)/i],
  ["zocdoc", /zocdoc\.com/i],
  ["mindbody", /mindbodyonline/i],
  ["fresha", /fresha\.com/i],
  ["glofox", /glofox\.com/i],
  ["square-appointments", /squareup\.com\/appointments/i],
  ["calendly", /calendly\.com\//i],
  ["acuity", /acuityscheduling\.com/i],
  ["hubspot-meetings", /meetings\.hubspot\.com/i],
  ["squarespace-scheduling", /squarespacescheduling\.com/i],
  ["setmore", /setmore\.com/i],
  ["checkfront", /checkfront\.com/i],
];

const IMMERSIVE_PATTERNS: Array<[string, RegExp]> = [
  ["matterport", /matterport\.com/i],
  ["roundme", /roundme\.com/i],
  ["krpano", /krpano/i],
  ["360-tour-generic", /virtual[-_ ]?tour|360[-_ ]?tour|panorama[-_ ]?tour/i],
  ["iframe-tour", /<iframe[^>]*\b(?:tour|pano|360|matterport)\b[^>]*>/i],
  ["gltf", /\.glb(?:\?|["'])/i],
];

const NOISE_PATH = /\/(?:privacy|terms|cookie|legal|disclaimer|sitemap|category|tag|archive|feed|wp-json|wp-admin|author|page\/\d+)(?:\/|$|\.|\?)/i;

async function fetchText(url: string, timeoutMs = 8000): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, text, status: res.status };
  } catch {
    return { ok: false, text: "", status: 0 };
  }
}

async function fetchSitemapPages(origin: string): Promise<string[]> {
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/wp-sitemap.xml`,
  ];
  const out = new Set<string>();
  for (const c of candidates) {
    const r = await fetchText(c, 6000);
    if (!r.ok || !r.text) continue;

    // Nested sitemap index
    const nested = [...r.text.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!.trim());
    for (const sub of nested.slice(0, 6)) {
      const sr = await fetchText(sub, 6000);
      if (sr.ok) {
        for (const m of sr.text.matchAll(/<url>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
          out.add(m[1]!.trim());
        }
      }
    }
    // Flat sitemap
    for (const m of r.text.matchAll(/<url>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      out.add(m[1]!.trim());
    }
    if (out.size > 0) break;
  }
  return [...out];
}

function countContentPages(urls: string[], origin: string): number {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return urls.length;
  }
  let n = 0;
  for (const u of urls) {
    try {
      const parsed = new URL(u);
      if (parsed.host !== host) continue;
      if (NOISE_PATH.test(parsed.pathname)) continue;
      n++;
    } catch {
      continue;
    }
  }
  return n;
}

function detectBookingEngine(html: string): { has: boolean; domains: string[] } {
  const hits: string[] = [];
  for (const [name, re] of BOOKING_PATTERNS) {
    if (re.test(html)) hits.push(name);
  }
  return { has: hits.length > 0, domains: hits };
}

function detectImmersive(html: string): { has: boolean; domains: string[] } {
  const hits: string[] = [];
  for (const [name, re] of IMMERSIVE_PATTERNS) {
    if (re.test(html)) hits.push(name);
  }
  return { has: hits.length > 0, domains: hits };
}

function detectCopyrightYear(html: string): number | null {
  const m = html.match(/(?:©|&copy;|\(c\)|copyright\s+)\s*(20\d{2})/i);
  return m ? Number(m[1]) : null;
}

function detectHasModernGrid(html: string): boolean {
  // Cheap check: a style rule that uses grid / flex with gap
  return /display\s*:\s*grid|display\s*:\s*flex[^;]*;\s*[^}]*gap\s*:/i.test(html);
}

function detectPreloadedFont(html: string): boolean {
  return /<link[^>]+rel=["']preload["'][^>]+as=["']font["']|<link[^>]+rel=["']preconnect["'][^>]+fonts\.gstatic/i.test(html);
}

export async function analyzeSiteStrength(website: string): Promise<SiteStrengthResult> {
  let url: URL;
  try {
    url = new URL(website.startsWith("http") ? website : `https://${website}`);
  } catch {
    return makeEmpty(false);
  }

  const origin = url.origin;

  // Fetch homepage + sitemap in parallel
  const [homepageRes, sitemapUrls] = await Promise.all([
    fetchText(origin + "/", 8000),
    fetchSitemapPages(origin),
  ]);

  if (!homepageRes.ok || !homepageRes.text) {
    logger.info({ website, status: homepageRes.status }, "site_strength: homepage fetch failed");
    return makeEmpty(false);
  }

  const html = homepageRes.text;
  const lowerHtml = html.toLowerCase();

  const booking = detectBookingEngine(html);
  const immersive = detectImmersive(html);
  const copyrightYear = detectCopyrightYear(html);
  const contentPageCount = countContentPages(sitemapUrls, origin);

  const signals: SiteStrengthSignals = {
    sitemapPageCount: sitemapUrls.length,
    contentPageCount,
    hasBookingEngine: booking.has,
    hasImmersive: immersive.has,
    hasSchemaOrg: /<script[^>]+application\/ld\+json/i.test(html),
    hasOgImage: /<meta[^>]+property=["']og:image["']/i.test(html),
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    hasManifest: /<link[^>]+rel=["']manifest["']|manifest\.webmanifest/i.test(lowerHtml),
    hasPreloadedFont: detectPreloadedFont(html),
    hasModernCssGrid: detectHasModernGrid(html),
    copyrightYear,
    footerYearCurrent: copyrightYear !== null && copyrightYear >= new Date().getFullYear() - 1,
    detectedBookingDomains: booking.domains,
    detectedImmersiveDomains: immersive.domains,
  };

  // Scoring (each signal 0-2 weight)
  let score = 0;
  const reasons: string[] = [];

  if (signals.hasBookingEngine) {
    score += 2;
    reasons.push(`has booking engine (${booking.domains.join(", ")})`);
  }
  if (signals.hasImmersive) {
    score += 2;
    reasons.push(`has immersive content (${immersive.domains.join(", ")})`);
  }
  if (signals.footerYearCurrent) {
    score += 1;
    reasons.push(`current copyright year (${copyrightYear})`);
  }
  if (signals.hasSchemaOrg) {
    score += 1;
    reasons.push("has schema.org structured data");
  }
  if (signals.hasOgImage && signals.hasViewport) {
    score += 0.5;
  }
  if (signals.hasPreloadedFont) {
    score += 0.5;
    reasons.push("preloads web fonts (perf-aware)");
  }
  if (signals.hasManifest) {
    score += 0.5;
  }
  if (signals.hasModernCssGrid) {
    score += 0.5;
  }
  if (contentPageCount >= HARD_PAGE_COUNT_SKIP) {
    score += 3;
    reasons.push(`deep sitemap (${contentPageCount} content pages)`);
  } else if (contentPageCount >= 5) {
    score += 1.5;
    reasons.push(`multi-page sitemap (${contentPageCount} content pages)`);
  }

  const strong =
    score >= STRONG_THRESHOLD || contentPageCount >= HARD_PAGE_COUNT_SKIP;

  return {
    score: Math.round(score * 10) / 10,
    strong,
    signals,
    reasons,
    scannedHomepageOk: true,
  };
}

function makeEmpty(scanned: boolean): SiteStrengthResult {
  return {
    score: 0,
    strong: false,
    signals: {
      sitemapPageCount: 0,
      contentPageCount: 0,
      hasBookingEngine: false,
      hasImmersive: false,
      hasSchemaOrg: false,
      hasOgImage: false,
      hasViewport: false,
      hasManifest: false,
      hasPreloadedFont: false,
      hasModernCssGrid: false,
      copyrightYear: null,
      footerYearCurrent: false,
      detectedBookingDomains: [],
      detectedImmersiveDomains: [],
    },
    reasons: [],
    scannedHomepageOk: scanned,
  };
}
