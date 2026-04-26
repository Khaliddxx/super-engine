import { env } from "../lib/env.js";

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  userRatingCount: number | null;
  website: string | null;
  phone: string | null;
  businessStatus: string | null;
}

const PLACES_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,places.businessStatus,nextPageToken";

function mapPlace(p: any): PlaceResult {
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? null,
    website: p.websiteUri ?? null,
    phone: p.nationalPhoneNumber ?? null,
    businessStatus: p.businessStatus ?? null,
  };
}

/**
 * Uses the new Places API (New). Docs:
 *   https://developers.google.com/maps/documentation/places/web-service/text-search
 *
 * Supports pagination via `nextPageToken` — Places (New) returns up to 60
 * results total per textQuery (3 pages of 20). We loop pages until we hit
 * `max` or run out.
 */
export async function textSearch(query: string, opts: { max?: number } = {}): Promise<PlaceResult[]> {
  const max = Math.max(1, opts.max ?? 20);
  const url = "https://places.googleapis.com/v1/places:searchText";
  const out: PlaceResult[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 3; page++) {
    const remaining = max - out.length;
    if (remaining <= 0) break;
    const body: Record<string, unknown> = {
      textQuery: query,
      pageSize: Math.min(remaining, 20),
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env().GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Places textSearch failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as { places?: any[]; nextPageToken?: string };
    for (const p of json.places ?? []) {
      out.push(mapPlace(p));
      if (out.length >= max) break;
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
    // The new Places API serves the next page immediately — no token-warmup
    // delay needed (unlike legacy Places API).
  }

  return out;
}

/**
 * Run several text-search queries in parallel and dedupe results by placeId.
 * Used by the scout to broaden coverage well past the 60-result-per-query cap.
 */
export async function textSearchMulti(
  queries: string[],
  opts: { maxPerQuery?: number; totalMax?: number } = {},
): Promise<PlaceResult[]> {
  const maxPerQuery = Math.max(1, opts.maxPerQuery ?? 60);
  const totalMax = Math.max(1, opts.totalMax ?? 200);
  const tasks = queries.map((q) =>
    textSearch(q, { max: maxPerQuery }).catch((err) => {
      // We'd rather return a partial result than fail the whole scout.
      console.warn(`textSearch failed for "${q}":`, err);
      return [] as PlaceResult[];
    }),
  );
  const lists = await Promise.all(tasks);
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const list of lists) {
    for (const p of list) {
      if (!p.placeId || seen.has(p.placeId)) continue;
      seen.add(p.placeId);
      out.push(p);
      if (out.length >= totalMax) return out;
    }
  }
  return out;
}

export interface ScreenshotOptions {
  width?: number;
  height?: number;
}

/**
 * Get a screenshot of a URL for vision-based qualification.
 * Uses the free microlink.io API (no auth, rate-limited but fine for low volume).
 */
export async function screenshot(siteUrl: string, opts: ScreenshotOptions = {}): Promise<string> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 900;
  const api = `https://api.microlink.io/?url=${encodeURIComponent(siteUrl)}&screenshot=true&meta=false&viewport.width=${width}&viewport.height=${height}&waitFor=3500&waitUntil=networkidle0`;
  const res = await fetch(api);
  if (!res.ok) throw new Error(`Screenshot failed: ${res.status}`);
  const data = (await res.json()) as { status: string; data?: { screenshot?: { url?: string } } };
  const url = data.data?.screenshot?.url;
  if (!url) throw new Error("Screenshot URL missing");
  return url;
}
