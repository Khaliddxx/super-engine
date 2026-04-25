import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export interface ScrapeResult {
  url: string;
  markdown: string;
  html: string;
  metadata: Record<string, unknown>;
  statusCode: number | null;
}

export interface ScrapeOptions {
  waitFor?: number;
  timeout?: number;
}

export async function scrape(url: string, opts: ScrapeOptions = {}): Promise<ScrapeResult> {
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env().FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "html"],
      onlyMainContent: false,
      waitFor: opts.waitFor ?? 2500,
      timeout: opts.timeout ?? 25000,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl scrape failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { data?: any };
  const data = json.data ?? {};
  return {
    url,
    markdown: data.markdown ?? "",
    html: data.html ?? "",
    metadata: data.metadata ?? {},
    statusCode: data.metadata?.statusCode ?? null,
  };
}

export interface ExtractedSiteInfo {
  services: string[];
  heroCopy: string;
  copyrightYear: number | null;
  textLength: number;
}

export function extractSiteInfo(result: ScrapeResult): ExtractedSiteInfo {
  const md = result.markdown ?? "";
  const textLength = md.replace(/\s+/g, " ").trim().length;

  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);
  const heroCopy =
    lines.find((l) => l.length > 40 && l.length < 400 && !l.startsWith("#") && !l.startsWith("!")) ?? lines[0] ?? "";

  const headingMatches = [...md.matchAll(/^##?#?\s+(.+)$/gm)]
    .map((m) => m[1]!.trim())
    .filter((h) => h.length > 2 && h.length < 60);
  const services = Array.from(new Set(headingMatches)).slice(0, 8);

  const yearMatch = md.match(/(?:©|\(c\)|Copyright\s+)\s*(20\d{2})/i);
  const copyrightYear = yearMatch ? Number(yearMatch[1]) : null;

  return { services, heroCopy: heroCopy.slice(0, 500), copyrightYear, textLength };
}

// ─────────────────────────────────────────────
//  Sitemap-aware scraping
// ─────────────────────────────────────────────

const HIGH_SIGNAL_PATH_PATTERNS = [
  /\/services?(\/|$|\.)/i,
  /\/about(\/|$|\.)/i,
  /\/menu(\/|$|\.)/i,
  /\/team(\/|$|\.)/i,
  /\/contact(\/|$|\.)/i,
  /\/pricing(\/|$|\.)/i,
  /\/work(\/|$|\.)/i,
  /\/gallery(\/|$|\.)/i,
  /\/portfolio(\/|$|\.)/i,
  /\/book(\/|$|\.)/i,
];

function normalizeUrl(u: string, base: string): string | null {
  try {
    const abs = new URL(u, base).toString();
    return abs.replace(/#.*$/, "").replace(/\?.*$/, "");
  } catch {
    return null;
  }
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

async function fetchSitemapXml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "SuperEngineBot/1.0" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export async function fetchSitemapUrls(origin: string): Promise<string[]> {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`];
  const urls = new Set<string>();

  for (const candidate of candidates) {
    const xml = await fetchSitemapXml(candidate);
    if (!xml) continue;

    // Handle sitemap index (nested sitemaps)
    const sitemapLocs = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!.trim());
    for (const sub of sitemapLocs.slice(0, 5)) {
      const subXml = await fetchSitemapXml(sub);
      if (subXml) {
        for (const m of subXml.matchAll(/<url>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
          const clean = normalizeUrl(m[1]!.trim(), origin);
          if (clean && sameOrigin(clean, origin)) urls.add(clean);
        }
      }
    }

    // Handle plain sitemap
    for (const m of xml.matchAll(/<url>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const clean = normalizeUrl(m[1]!.trim(), origin);
      if (clean && sameOrigin(clean, origin)) urls.add(clean);
    }

    if (urls.size > 0) break;
  }

  return [...urls];
}

function extractAnchorHrefs(html: string, baseUrl: string, origin: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const clean = normalizeUrl(m[1]!, baseUrl);
    if (clean && sameOrigin(clean, origin)) found.add(clean);
  }
  return [...found];
}

function rankUrls(urls: string[], homepage: string): string[] {
  const seen = new Set<string>([homepage]);
  const highSignal: string[] = [];
  const rest: string[] = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    if (HIGH_SIGNAL_PATH_PATTERNS.some((re) => re.test(u))) highSignal.push(u);
    else rest.push(u);
  }
  return [...highSignal, ...rest];
}

export interface SiteScrapeOptions {
  maxPages?: number;
  perPageTimeoutMs?: number;
}

export async function scrapeSite(
  url: string,
  opts: SiteScrapeOptions = {},
): Promise<ScrapeResult[]> {
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 5, 10));
  const perPageTimeout = opts.perPageTimeoutMs ?? 15000;

  let origin: string;
  try {
    origin = new URL(url.startsWith("http") ? url : `https://${url}`).origin;
  } catch {
    return [];
  }
  const homepage = `${origin}/`;

  let homepageResult: ScrapeResult | null = null;
  try {
    homepageResult = await scrape(homepage, { waitFor: 1000, timeout: perPageTimeout });
  } catch (err) {
    logger.warn({ err: (err as Error).message, homepage }, "homepage scrape failed");
  }

  let candidateUrls: string[] = [];
  try {
    candidateUrls = await fetchSitemapUrls(origin);
  } catch (err) {
    logger.warn({ err: (err as Error).message, origin }, "sitemap fetch failed");
  }

  if (candidateUrls.length === 0 && homepageResult) {
    candidateUrls = extractAnchorHrefs(homepageResult.html ?? "", homepage, origin);
  }

  const ranked = rankUrls(candidateUrls, homepage).slice(0, Math.max(0, maxPages - 1));

  const results: ScrapeResult[] = [];
  if (homepageResult) results.push(homepageResult);

  // Fetch remaining pages in parallel, never fail-all
  const settled = await Promise.allSettled(
    ranked.map((u) => scrape(u, { waitFor: 1000, timeout: perPageTimeout })),
  );
  for (const s of settled) {
    if (s.status === "fulfilled") results.push(s.value);
  }

  logger.info(
    { origin, pagesScraped: results.length, candidateCount: candidateUrls.length },
    "scrapeSite complete",
  );
  return results;
}

export type PageType =
  | "home"
  | "about"
  | "services"
  | "menu"
  | "rooms"
  | "treatments"
  | "gallery"
  | "team"
  | "contact"
  | "book"
  | "pricing"
  | "blog"
  | "other";

export interface SitemapEntry {
  slug: string; // e.g. "menu.html" (preview route name)
  type: PageType;
  title: string;
  snippet: string;
  sourceUrl: string;
}

export interface RichSiteInfo {
  services: string[];
  heroCopy: string;
  aboutCopy: string;
  testimonials: string[];
  teamNames: string[];
  hours: string | null;
  pricingMentions: string[];
  copyrightYear: number | null;
  totalTextLength: number;
  pagesScraped: Array<{ url: string; title: string; length: number }>;
  sitemap: SitemapEntry[];
}

function extractTestimonials(md: string): string[] {
  const out: string[] = [];
  // Markdown blockquotes with enough substance
  for (const m of md.matchAll(/^>\s?(.+(?:\n>\s?.+)*)$/gm)) {
    const cleaned = m[1]!
      .split("\n")
      .map((l) => l.replace(/^>\s?/, "").trim())
      .join(" ")
      .trim();
    if (cleaned.length >= 40 && cleaned.length <= 400) out.push(cleaned);
  }
  // Plain "quoted text" blocks of substance
  for (const m of md.matchAll(/(["“])([^"”\n]{40,320})(["”])/g)) {
    const q = m[2]!.trim();
    if (!out.includes(q)) out.push(q);
  }
  return [...new Set(out)].slice(0, 5);
}

function findAboutCopy(results: ScrapeResult[]): string {
  for (const r of results) {
    if (/\/about/i.test(r.url)) {
      const md = r.markdown ?? "";
      const paras = md
        .split(/\n\s*\n/)
        .map((p) => p.replace(/^#+\s*/, "").trim())
        .filter((p) => p.length > 120 && p.length < 2000 && !p.startsWith("!") && !p.startsWith("["));
      if (paras[0]) return paras[0].slice(0, 1200);
    }
  }
  // Fallback: look for "about us" section on homepage
  const home = results[0];
  if (!home) return "";
  const md = home.markdown ?? "";
  const aboutMatch = md.match(/##?#?\s*about[^\n]*\n+([\s\S]{200,1200}?)(?=\n##?#?\s|\n---|$)/i);
  if (aboutMatch) return aboutMatch[1]!.trim().slice(0, 1200);
  return "";
}

function extractTeamNames(results: ScrapeResult[]): string[] {
  for (const r of results) {
    if (!/\/team|\/about|\/staff/i.test(r.url)) continue;
    const md = r.markdown ?? "";
    // Look for name-like patterns in headings: "Jane Doe" or "Dr. John Smith"
    const names = [...md.matchAll(/^#{2,4}\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s*$/gm)]
      .map((m) => m[1]!.trim())
      .filter((n) => n.split(" ").length <= 3);
    if (names.length) return [...new Set(names)].slice(0, 10);
  }
  return [];
}

function extractHours(results: ScrapeResult[]): string | null {
  for (const r of results) {
    const md = r.markdown ?? "";
    const m = md.match(
      /(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s*[-–:]?\s*(?:[^\n]{1,80}))(?:\n(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[^\n]{1,80})){1,6}/,
    );
    if (m) return m[0].slice(0, 400);
  }
  return null;
}

function extractPricingMentions(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/(?:from\s+)?(?:\$|£|€|A\$|AUD|USD|GBP|EUR)\s?\d{1,5}(?:[.,]\d{2})?(?:\s?\/\s?\w+)?/gi)) {
    const t = m[0].trim();
    if (t.length < 40 && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 10);
}

function classifyPage(url: string, title: string): PageType {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  const titleLc = title.toLowerCase();
  if (path === "/" || path === "") return "home";
  const rules: Array<[PageType, RegExp[]]> = [
    ["about", [/\babout\b/, /\bour[-_ ]story\b/, /\bwho[-_ ]we[-_ ]are\b/]],
    ["services", [/\bservices?\b/, /\bwhat[-_ ]we[-_ ]do\b/, /\btreatments?\b/, /\bsolutions?\b/]],
    ["menu", [/\bmenu\b/, /\bfood\b/, /\bdrinks?\b/, /\bwine[-_ ]list\b/]],
    ["rooms", [/\brooms?\b/, /\bsuites?\b/, /\baccommodation\b/, /\bvenues?\b/, /\bspaces?\b/]],
    ["treatments", [/\btreatments?\b/, /\bprocedures?\b/]],
    ["gallery", [/\bgalleries?\b/, /\bgallery\b/, /\bportfolio\b/, /\bphotos?\b/, /\bwork\b/]],
    ["team", [/\bteam\b/, /\bstaff\b/, /\bpeople\b/, /\bdoctors?\b/, /\bdentists?\b/]],
    ["contact", [/\bcontact\b/, /\bfind[-_ ]us\b/, /\blocation\b/, /\bvisit\b/]],
    ["book", [/\bbook(?:ing)?\b/, /\breserv(?:e|ations?)\b/, /\bappointments?\b/]],
    ["pricing", [/\bpricing\b/, /\brates?\b/, /\bfees?\b/]],
    ["blog", [/\bblog\b/, /\bnews\b/, /\barticles?\b/, /\binsights?\b/]],
  ];
  for (const [type, patterns] of rules) {
    if (patterns.some((re) => re.test(path) || re.test(titleLc))) return type;
  }
  return "other";
}

/**
 * Decide which scraped pages become distinct routes in the generated mock.
 * We mirror the REAL sitemap (home + the 3-4 most informative type-matches)
 * rather than inventing a generic one-pager shape.
 */
function buildSitemap(results: ScrapeResult[]): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const seenTypes = new Set<PageType>();

  for (const r of results) {
    const title = String((r.metadata as any)?.title ?? r.url).slice(0, 160);
    const type = classifyPage(r.url, title);
    if (seenTypes.has(type) && type !== "other") continue;
    seenTypes.add(type);

    const md = r.markdown ?? "";
    const firstPara = md
      .split(/\n\s*\n/)
      .map((p) => p.replace(/^#+\s*/, "").trim())
      .find((p) => p.length > 60 && p.length < 500) ?? "";

    // Map types to preview-route slugs.
    const slugBase =
      type === "home"
        ? "index"
        : type === "rooms"
        ? "rooms"
        : type === "treatments"
        ? "services"
        : type === "book"
        ? "contact"
        : type;
    entries.push({
      slug: `${slugBase}.html`,
      type,
      title,
      snippet: firstPara.slice(0, 500),
      sourceUrl: r.url,
    });
  }

  // Ensure index.html (home) is first
  entries.sort((a, b) => (a.type === "home" ? -1 : b.type === "home" ? 1 : 0));

  // De-dupe by slug (e.g. book+contact both map to contact.html → keep first)
  const bySlug = new Map<string, SitemapEntry>();
  for (const e of entries) if (!bySlug.has(e.slug)) bySlug.set(e.slug, e);
  return [...bySlug.values()].slice(0, 5);
}

export function extractRichSiteInfo(results: ScrapeResult[]): RichSiteInfo {
  if (results.length === 0) {
    return {
      services: [],
      heroCopy: "",
      aboutCopy: "",
      testimonials: [],
      teamNames: [],
      hours: null,
      pricingMentions: [],
      copyrightYear: null,
      totalTextLength: 0,
      pagesScraped: [],
      sitemap: [],
    };
  }

  const combinedMarkdown = results.map((r) => r.markdown ?? "").join("\n\n");
  const home = results[0]!;
  const homepageInfo = extractSiteInfo(home);

  const servicesSet = new Set<string>(homepageInfo.services);
  for (const r of results.slice(1)) {
    for (const s of extractSiteInfo(r).services) servicesSet.add(s);
  }
  const services = [...servicesSet].slice(0, 12);

  const testimonials = extractTestimonials(combinedMarkdown);
  const aboutCopy = findAboutCopy(results);
  const teamNames = extractTeamNames(results);
  const hours = extractHours(results);
  const pricingMentions = extractPricingMentions(combinedMarkdown);

  const yearMatch = combinedMarkdown.match(/(?:©|\(c\)|Copyright\s+)\s*(20\d{2})/i);
  const copyrightYear = yearMatch ? Number(yearMatch[1]) : null;

  const pagesScraped = results.map((r) => ({
    url: r.url,
    title: String((r.metadata as any)?.title ?? "").slice(0, 200),
    length: (r.markdown ?? "").replace(/\s+/g, " ").trim().length,
  }));

  const totalTextLength = pagesScraped.reduce((s, p) => s + p.length, 0);

  const sitemap = buildSitemap(results);

  return {
    services,
    heroCopy: homepageInfo.heroCopy,
    aboutCopy,
    testimonials,
    teamNames,
    hours,
    pricingMentions,
    copyrightYear,
    totalTextLength,
    pagesScraped,
    sitemap,
  };
}

// ─────────────────────────────────────────────
//  Asset extraction — real images, videos, logo, brand palette, fonts
//  Drives the "use their assets, not lame templates" redesign.
// ─────────────────────────────────────────────

export interface ScrapedAssets {
  logo: string | null;
  heroImage: string | null;
  heroVideo: string | null;
  images: string[]; // ranked, de-duped, absolute URLs
  videos: string[]; // absolute URLs to mp4/webm/youtube/vimeo
  ogImage: string | null;
  favicon: string | null;
  brandColors: string[]; // hex strings extracted from inline style / css
  brandFonts: string[]; // font-family names observed in <link> and inline styles
  socials: { facebook?: string; instagram?: string; linkedin?: string; youtube?: string; twitter?: string };
}

const IMG_BAD_PATTERNS = [
  /\/1x1\./i, /blank\./i, /spacer\./i, /pixel\./i,
  /data:image\/gif;base64,R0lGOD/i, // 1x1 trackers
  /googletagmanager/i, /facebook\.com\/tr/i, /doubleclick/i,
  /\.svg\?#/i,
];

function absolutize(u: string, base: string): string | null {
  try {
    const abs = new URL(u, base).toString();
    if (!/^https?:/i.test(abs)) return null;
    return abs;
  } catch {
    return null;
  }
}

function uniqueKeep<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function extractImagesFromHtml(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img\s+[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const u = absolutize(m[1]!, baseUrl);
    if (!u) continue;
    if (IMG_BAD_PATTERNS.some((re) => re.test(u))) continue;
    out.push(u);
  }
  for (const m of html.matchAll(/<source\s+[^>]*?srcset\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const firstCandidate = m[1]!.split(",")[0]?.trim().split(/\s+/)[0];
    if (!firstCandidate) continue;
    const u = absolutize(firstCandidate, baseUrl);
    if (u && !IMG_BAD_PATTERNS.some((re) => re.test(u))) out.push(u);
  }
  // background-image: url(...)
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(["']?([^"')]+)["']?\)/gi)) {
    const u = absolutize(m[1]!, baseUrl);
    if (u && !IMG_BAD_PATTERNS.some((re) => re.test(u))) out.push(u);
  }
  return uniqueKeep(out);
}

function extractVideosFromHtml(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<video\s+[^>]*?src\s*=\s*["']([^"']+)["']/gi)) {
    const u = absolutize(m[1]!, baseUrl);
    if (u) out.push(u);
  }
  for (const m of html.matchAll(/<video[\s\S]*?<source\s+[^>]*?src\s*=\s*["']([^"']+\.(?:mp4|webm))["']/gi)) {
    const u = absolutize(m[1]!, baseUrl);
    if (u) out.push(u);
  }
  for (const m of html.matchAll(
    /<iframe\s+[^>]*?src\s*=\s*["']([^"']*(?:youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)[^"']*)["']/gi,
  )) {
    const u = absolutize(m[1]!, baseUrl);
    if (u) out.push(u);
  }
  return uniqueKeep(out);
}

function extractLogo(html: string, baseUrl: string): string | null {
  const re = /<img\s+[^>]*?(?:class|id|alt)\s*=\s*["'][^"']*(?:logo|brand|site-logo)[^"']*["'][^>]*?src\s*=\s*["']([^"']+)["']/i;
  const m1 = re.exec(html);
  if (m1) return absolutize(m1[1]!, baseUrl);
  const re2 = /<img\s+[^>]*?src\s*=\s*["']([^"']+)["'][^>]*?(?:class|id|alt)\s*=\s*["'][^"']*(?:logo|brand|site-logo)[^"']*["']/i;
  const m2 = re2.exec(html);
  if (m2) return absolutize(m2[1]!, baseUrl);
  return null;
}

function extractOgImage(html: string, baseUrl: string): string | null {
  const m = /<meta\s+[^>]*?property\s*=\s*["']og:image["'][^>]*?content\s*=\s*["']([^"']+)["']/i.exec(html)
    ?? /<meta\s+[^>]*?content\s*=\s*["']([^"']+)["'][^>]*?property\s*=\s*["']og:image["']/i.exec(html);
  if (m) return absolutize(m[1]!, baseUrl);
  return null;
}

function extractFavicon(html: string, baseUrl: string): string | null {
  const m = /<link\s+[^>]*?rel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*?href\s*=\s*["']([^"']+)["']/i.exec(html);
  if (m) return absolutize(m[1]!, baseUrl);
  return null;
}

function extractHeroMedia(
  html: string,
  images: string[],
  videos: string[],
): { heroImage: string | null; heroVideo: string | null } {
  // Prefer the first <video> that appears before the first </section> close
  let heroVideo: string | null = null;
  const videoTagMatch = /<video[\s\S]*?<\/video>/i.exec(html);
  if (videoTagMatch && videos.length) {
    heroVideo = videos[0] ?? null;
  }
  let heroImage: string | null = null;
  for (const img of images) {
    const idx = html.indexOf(img.split("?")[0]!);
    if (idx !== -1 && idx < 6000) {
      heroImage = img;
      break;
    }
  }
  if (!heroImage && images[0]) heroImage = images[0];
  return { heroImage, heroVideo };
}

function extractBrandColors(html: string): string[] {
  const hexes = new Set<string>();
  for (const m of html.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[0].toLowerCase();
    // Ignore pure black/white and near-gray defaults
    if (["#000", "#000000", "#fff", "#ffffff", "#ccc", "#cccccc", "#eee", "#eeeeee"].includes(h)) continue;
    hexes.add(h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h);
  }
  // Rank by frequency of appearance in html
  const ranked = [...hexes]
    .map((h) => ({ h, n: (html.match(new RegExp(h.replace("#", "\\#"), "gi")) || []).length }))
    .sort((a, b) => b.n - a.n)
    .map((r) => r.h);
  return ranked.slice(0, 6);
}

function extractBrandFonts(html: string): string[] {
  const fonts = new Set<string>();
  // Google Fonts links
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?[^"']*family=([^"'&:]+)/gi)) {
    const name = decodeURIComponent(m[1]!).replace(/\+/g, " ").trim();
    if (name) fonts.add(name);
  }
  // font-family: "Name", ...
  for (const m of html.matchAll(/font-family\s*:\s*([^;"'{}<>]+)[;"']/gi)) {
    const first = m[1]!.split(",")[0]!.replace(/['"]/g, "").trim();
    if (first && !/^(?:serif|sans-serif|monospace|cursive|system-ui|-apple-system|inherit)$/i.test(first)) {
      fonts.add(first);
    }
  }
  return [...fonts].slice(0, 6);
}

function extractSocials(html: string): ScrapedAssets["socials"] {
  const out: ScrapedAssets["socials"] = {};
  const patterns: Array<[keyof ScrapedAssets["socials"], RegExp]> = [
    ["facebook", /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9._-]+/i],
    ["instagram", /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._-]+/i],
    ["linkedin", /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9._-]+/i],
    ["youtube", /https?:\/\/(?:www\.)?youtube\.com\/(?:c|channel|user|@)[A-Za-z0-9._-]+/i],
    ["twitter", /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9._-]+/i],
  ];
  for (const [k, re] of patterns) {
    const m = re.exec(html);
    if (m) out[k] = m[0];
  }
  return out;
}

/** Extract asset URLs and brand tokens from a site scrape. */
export function extractAssets(results: ScrapeResult[]): ScrapedAssets {
  if (results.length === 0) {
    return {
      logo: null, heroImage: null, heroVideo: null,
      images: [], videos: [], ogImage: null, favicon: null,
      brandColors: [], brandFonts: [], socials: {},
    };
  }
  const home = results[0]!;
  const html = home.html ?? "";
  const base = home.url;

  const allImages: string[] = [];
  const allVideos: string[] = [];
  for (const r of results) {
    allImages.push(...extractImagesFromHtml(r.html ?? "", r.url));
    allVideos.push(...extractVideosFromHtml(r.html ?? "", r.url));
  }

  const images = uniqueKeep(allImages).slice(0, 30);
  const videos = uniqueKeep(allVideos).slice(0, 10);
  const logo = extractLogo(html, base);
  const ogImage = extractOgImage(html, base);
  const favicon = extractFavicon(html, base);
  const { heroImage, heroVideo } = extractHeroMedia(html, images, videos);
  const brandColors = extractBrandColors(html);
  const brandFonts = extractBrandFonts(html);
  const socials = extractSocials(html);

  return {
    logo,
    heroImage: heroImage ?? ogImage,
    heroVideo,
    images,
    videos,
    ogImage,
    favicon,
    brandColors,
    brandFonts,
    socials,
  };
}
