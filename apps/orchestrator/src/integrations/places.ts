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

/**
 * Uses the new Places API (New). Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */
export async function textSearch(query: string, opts: { max?: number } = {}): Promise<PlaceResult[]> {
  const max = opts.max ?? 20;
  const url = "https://places.googleapis.com/v1/places:searchText";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env().GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,places.businessStatus",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: Math.min(max, 20) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Places textSearch failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { places?: any[] };
  return (json.places ?? []).map((p) => ({
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
  }));
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
  const api = `https://api.microlink.io/?url=${encodeURIComponent(siteUrl)}&screenshot=true&meta=false&viewport.width=${width}&viewport.height=${height}&waitFor=1500`;
  const res = await fetch(api);
  if (!res.ok) throw new Error(`Screenshot failed: ${res.status}`);
  const data = (await res.json()) as { status: string; data?: { screenshot?: { url?: string } } };
  const url = data.data?.screenshot?.url;
  if (!url) throw new Error("Screenshot URL missing");
  return url;
}
