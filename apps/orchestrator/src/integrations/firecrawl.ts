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
      waitFor: opts.waitFor ?? 1500,
      timeout: opts.timeout ?? 20000,
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
  };
}
