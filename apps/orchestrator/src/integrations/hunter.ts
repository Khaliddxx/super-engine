import { env } from "../lib/env.js";

export interface HunterEmail {
  value: string;
  type: string;
  confidence: number;
  firstName?: string;
  lastName?: string;
  position?: string;
  linkedin?: string;
}

export interface HunterDomainResult {
  domain: string;
  emails: HunterEmail[];
  linkedin: string | null;
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function domainSearch(websiteUrl: string): Promise<HunterDomainResult> {
  const domain = extractDomain(websiteUrl);
  const api = `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${env().HUNTER_API_KEY}&limit=10`;
  const res = await fetch(api);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hunter domainSearch failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { data?: { emails?: any[]; linkedin?: string } };
  const emails: HunterEmail[] = (json.data?.emails ?? []).map((e) => ({
    value: e.value,
    type: e.type ?? "generic",
    confidence: typeof e.confidence === "number" ? e.confidence : 0,
    firstName: e.first_name ?? undefined,
    lastName: e.last_name ?? undefined,
    position: e.position ?? undefined,
    linkedin: e.linkedin ?? undefined,
  }));
  return { domain, emails, linkedin: json.data?.linkedin ?? null };
}

/** Pick the best email for outreach: prefer personal > role > generic; highest confidence wins within tier. */
export function pickBestEmail(emails: HunterEmail[]): HunterEmail | null {
  if (!emails.length) return null;
  const tier = (e: HunterEmail): number => {
    const local = e.value.split("@")[0]?.toLowerCase() ?? "";
    if (e.type === "personal") return 3;
    if (/^(owner|founder|manager|ceo|director)/.test(local)) return 2;
    if (/^(info|contact|hello|hi|admin|office)/.test(local)) return 1;
    return 0;
  };
  return [...emails].sort((a, b) => tier(b) - tier(a) || (b.confidence ?? 0) - (a.confidence ?? 0))[0] ?? null;
}

/** Pick the best LinkedIn URL: prefer personal email owner's LI, else domain LI. */
export function pickLinkedInUrl(result: HunterDomainResult, bestEmail: HunterEmail | null): string | null {
  if (bestEmail?.linkedin) return bestEmail.linkedin;
  for (const e of result.emails) if (e.linkedin) return e.linkedin;
  return result.linkedin ?? null;
}
