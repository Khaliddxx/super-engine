import { env } from "../lib/env.js";

export interface ScrapeResult {
  markdown: string;
  html: string;
  metadata: Record<string, unknown>;
  statusCode: number | null;
}

export async function scrape(url: string): Promise<ScrapeResult> {
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
      waitFor: 1500,
      timeout: 20000,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl scrape failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { data?: any };
  const data = json.data ?? {};
  return {
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

  // Hero copy: first non-trivial paragraph
  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);
  const heroCopy = lines.find((l) => l.length > 40 && l.length < 400 && !l.startsWith("#") && !l.startsWith("!")) ?? lines[0] ?? "";

  // Services: look for H2/H3 sections or bullet clusters
  const headingMatches = [...md.matchAll(/^##?#?\s+(.+)$/gm)].map((m) => m[1]!.trim()).filter((h) => h.length > 2 && h.length < 60);
  const services = Array.from(new Set(headingMatches)).slice(0, 8);

  // Copyright year: look for © 20xx or Copyright 20xx
  const yearMatch = md.match(/(?:©|\(c\)|Copyright\s+)\s*(20\d{2})/i);
  const copyrightYear = yearMatch ? Number(yearMatch[1]) : null;

  return { services, heroCopy: heroCopy.slice(0, 500), copyrightYear, textLength };
}
