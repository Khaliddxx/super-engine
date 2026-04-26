export interface RedesignAssets {
  logo: string | null;
  heroImage: string | null;
  heroVideo: string | null;
  images: string[];
  videos: string[];
  ogImage: string | null;
  favicon: string | null;
  brandColors: string[];
  brandFonts: string[];
  socials: Record<string, string | undefined>;
}

export interface RedesignSitemapEntry {
  slug: string; // "index.html" | "about.html" | "menu.html" | "contact.html" | ...
  type: string; // "home" | "about" | "services" | "menu" | "rooms" | "gallery" | "team" | "contact" | "book" | ...
  title: string;
  snippet: string;
  sourceUrl: string;
}

export interface RedesignInput {
  name: string;
  niche: string;
  city: string;
  scraped_services: string[];
  scraped_copy: string;
  scraped_about_copy?: string;
  scraped_testimonials?: string[];
  scraped_pages_summary?: string;
  sitemap: RedesignSitemapEntry[]; // pages to generate, ordered; always starts with index.html
  assets: RedesignAssets;
  years: string;
  current_year: number;
  /** Per-prospect creative archetype — picked deterministically from prospect ID. */
  archetype: { id: string; name: string; brief: string };
  /** Free-text operator override. If present, it dominates every other instruction in the prompt. */
  operator_instruction?: string | null;
  /** Niche-level fallbacks. ONLY used if scraped data is empty for that field. */
  fallback_primary_cta: string;
  fallback_secondary_cta: string;
  fallback_tagline: string;
  fallback_services: Array<{ name: string; desc: string }>;
  business_contact: {
    phone: string | null;
    email: string | null;
    address: string | null;
    bookingUrl: string | null; // scraped booking engine URL if detected
  };
}

function list(items: string[], limit = 12): string {
  if (!items.length) return "(none)";
  return items
    .slice(0, limit)
    .map((s) => `- ${s}`)
    .join("\n");
}

function safe(s: string | null | undefined): string {
  return (s ?? "").trim() || "(none)";
}

function sitemapBlock(entries: RedesignSitemapEntry[]): string {
  if (!entries.length) return "- index.html (type=home)";
  return entries
    .map((e) => `- ${e.slug} (type=${e.type}, title=${JSON.stringify(e.title)}, snippet=${JSON.stringify(e.snippet.slice(0, 180))})`)
    .join("\n");
}

/**
 * REDESIGN V3
 *
 * Why V3 exists: V2 was producing visually identical sites within a niche
 * because (a) cached `verticalTemplate` data was treated as authoritative,
 * (b) the "page-type conventions" block prescribed the same structure for
 * every site of a type, and (c) the prompt jumped straight to HTML with no
 * per-business creative direction. V3 fixes all three:
 *   1. Adds an `<operator_instruction>` block at the top — when the operator
 *      writes an edit ("make it darker", "remove testimonials"), it
 *      dominates every other rule below.
 *   2. Adds a `<creative_direction>` block with a per-prospect layout
 *      ARCHETYPE (editorial, gallery-led, document, brutalist, etc.) plus
 *      an explicit anti-template clause. Two sites of the same niche will
 *      get different archetypes via deterministic hashing on prospect ID.
 *   3. Demotes the niche template fields to `<fallback_intel>` and tells
 *      Claude to ignore them unless the scraped data is empty for that
 *      field. Stops the "every law firm = Practice Areas grid" pattern.
 *   4. Drops the prescriptive page-type conventions list. Instead, Claude
 *      must derive each page's content & structure from the actual scraped
 *      content for THIS business.
 */
export const REDESIGN_PROMPT_V2 = {
  version: "3.0",
  deployedAt: "2026-04-26",
  render: (i: RedesignInput) => `${
    (i.operator_instruction ?? "").trim()
      ? `<operator_instruction priority="HIGHEST">
The operator has reviewed this prospect and wants you to do the following.
This OVERRIDES any conflicting rule below. Apply it visibly and confidently.

${i.operator_instruction!.trim()}

If the instruction asks for a different visual direction, REPLACE the archetype below — don't try to merge.
</operator_instruction>

`
      : ""
  }You are a senior product designer building a production-quality, MOBILE-FIRST, MULTI-PAGE website redesign for a local business.
This is NOT a template fill-in. It is a bespoke redesign using THE BUSINESS'S OWN ASSETS (their real photos, videos, logo, brand colors) and MIRRORING their real sitemap.
The business owner will see this on their phone in a cold outreach message. It must feel like you actually studied their site, because you did.

<business>
Name: ${i.name}
Niche: ${i.niche}
City: ${i.city}
Years in business: ${i.years}
Current year: ${i.current_year}

About / hero copy scraped from their live site:
${safe(i.scraped_about_copy) !== "(none)" ? safe(i.scraped_about_copy) : safe(i.scraped_copy)}

Services the site actually lists:
${list(i.scraped_services)}

Customer testimonials scraped from the site (do NOT fabricate):
${list((i.scraped_testimonials ?? []).map((t) => `"${t.replace(/"/g, '\\"')}"`))}

Pages crawled: ${i.scraped_pages_summary ?? "(homepage only)"}
</business>

<creative_direction>
ARCHETYPE for this prospect: **${i.archetype.name}** (id=${i.archetype.id})
${i.archetype.brief}

Anti-template rule: do NOT default to the most obvious layout for this niche.
A law firm should not automatically look like every other law firm. A nightclub
should not automatically be a black-and-neon hero stack. Lean into the chosen
archetype above — pick layout choices that another agency would be afraid to
ship for this niche, but that genuinely fit THIS business's scraped content.

Concrete things that count as "templated" (avoid):
  • A 3-equal-cards "services" / "practice areas" grid as the home's primary section.
  • A hero with a centered headline + two side-by-side CTAs and nothing else above the fold.
  • Generic "Why choose us" / "Our process" sections with icon + title + paragraph trios.
  • Pasting the business name into a copy slot you'd have written before reading their site.

Concrete things that count as bespoke (do):
  • Asymmetric layouts. Editorial pull-quotes set in display type. Sidebars.
  • A homepage section structure that's specific to THIS business's actual offerings,
    not the niche-generic ones.
  • A typographic decision (a real display face, ligatures, a bold case treatment, an
    angular grotesk vs. a refined serif) that signals the brand's personality.
  • Real photo treatments — duotones, full-bleed editorial spreads, layered crops.
</creative_direction>

<sitemap_to_generate>
Generate these pages, in order. Each page must share the SAME nav and footer
markup, but each page's main content differs based on what THIS business
actually has on their site (see scraped data above):

${sitemapBlock(i.sitemap)}

For each page, decide its content by reading the scraped snippet + page type
+ the business's real services/copy. Do NOT auto-fill from a niche recipe.
The goal is "if you opened the live site and reorganized it beautifully" —
not "what does a generic <type> page look like?".
</sitemap_to_generate>

<real_assets>
These are the business's OWN assets scraped from their live site. USE THEM.

Logo URL: ${i.assets.logo ?? "(none — use a clean wordmark of the business name in the brand font)"}
Favicon URL: ${i.assets.favicon ?? "(none)"}
Hero image URL: ${i.assets.heroImage ?? "(none)"}
Hero video URL: ${i.assets.heroVideo ?? "(none)"}
OG image URL: ${i.assets.ogImage ?? "(none)"}

All image URLs available (use these directly as src="..."):
${list(i.assets.images, 24)}

All video URLs available (use <video> tag with muted autoplay loop playsinline for backgrounds):
${list(i.assets.videos, 6)}

Brand colors detected on their current site (hex): ${i.assets.brandColors.join(", ") || "(none — derive a complementary palette from the hero image)"}
Brand fonts detected: ${i.assets.brandFonts.join(", ") || "(none — pick a modern pairing from Google Fonts)"}

Social links: ${JSON.stringify(i.assets.socials)}
</real_assets>

<fallback_intel ignore_unless_scraped_data_is_empty="true">
You may IGNORE this entire block. It is niche-generic advice that should
ONLY be used if the corresponding scraped field above is empty (no services,
no copy, no testimonials). Never let these labels become the dominant voice
of the site — the business's own scraped content is always primary.

Tagline direction (use only if no usable scraped copy): ${i.fallback_tagline}
Primary CTA label suggestion: ${i.fallback_primary_cta}
Secondary CTA label suggestion: ${i.fallback_secondary_cta}
Service shells if scraped list is empty:
${JSON.stringify(i.fallback_services)}
</fallback_intel>

<business_contact>
This is the BUSINESS's own contact info, pulled from their live site. Use these in the contact section and as the targets of CTAs. Do NOT use any agency / designer contact info — there is none in this prompt on purpose.
Phone: ${i.business_contact.phone ?? "(not scraped — omit phone CTA rather than fabricate)"}
Email: ${i.business_contact.email ?? "(not scraped — omit email CTA rather than fabricate)"}
Address: ${i.business_contact.address ?? "(not scraped)"}
Existing booking engine URL (if any): ${i.business_contact.bookingUrl ?? "(none)"}
</business_contact>

<hard_requirements>

## Output format (STRICT)
1. Output a SINGLE JSON object and NOTHING ELSE. No prose, no markdown fences, no commentary.
2. Shape: { "pages": [ { "slug": "index.html", "html": "<!DOCTYPE html>..." }, ... ] }
3. One object per entry in <sitemap_to_generate>. "slug" must match exactly (index.html, about.html, etc).
4. Each "html" value MUST be a complete self-contained HTML document starting with <!DOCTYPE html>.
5. Each page must share identical <head> (fonts, CSS variables, meta viewport), nav markup, and footer markup — only the <main> content differs.

## HEAD requirements (every page)
6. <meta charset="utf-8"> and <meta name="viewport" content="width=device-width, initial-scale=1">.
7. <title> differs per page: "\${page title} · ${i.name}" (except home which is just "${i.name}").
8. One <style> block inline — no external stylesheets except fonts.googleapis.com imports.
9. If brand fonts were detected, import them from fonts.googleapis.com. Else pick a considered pairing (Fraunces+Inter, Playfair Display+Nunito, Söhne-style via Inter+Plus Jakarta Sans).

## Mobile-first CSS (every page)
10. Base styles target a 375px viewport. Desktop styles go inside @media (min-width: 768px).
11. Use fluid type: clamp() for h1/h2/h3. No fixed px widths on containers — max-width only.
12. Nothing overflows horizontally at 375px. No 100vw calc traps.
13. Tap targets ≥ 44x44px. Buttons and nav links have visible focus states.

## Navbar (every page — identical markup)
14. Logo sits left (h=40-44px). If no logo asset, use a wordmark in the display font.
15. Nav links sit right (desktop) or collapse to a hamburger sheet (mobile, <768px).
16. Horizontal gap between nav links: clamp(1rem, 3vw, 2.5rem). Do NOT use 0 or inconsistent gaps.
17. Primary CTA flush right on desktop; in the hamburger sheet on mobile.
18. The nav is sticky (position: sticky; top: 0) with a solid or blurred background so text stays legible over imagery.
19. Current page's nav link has a subtle active state (underline or weight).
20. Links go to SIBLING PAGES (from the sitemap slugs): "/index.html", "/about.html", etc. NEVER link to ${i.name}'s live domain or any external URL (other than booking engine + social + fonts).

## Hero / imagery
21. Hero on home: if heroVideo present, use <video autoplay muted loop playsinline> with a dark overlay. Else if heroImage present, use <img> full-bleed. Only if BOTH absent may you do a typographic hero.
22. Non-home pages should have a shorter "section hero" — no full-bleed video required.
23. Use at least 3 of the provided image URLs as actual <img src="..."> elements across the pages when 3+ images are available. Prefer the real scraped images over gradients.
24. No stock photo URLs from other sites. Only URLs listed in <real_assets> or Google Fonts.

## Brand palette
25. Derive CSS variables from brandColors: map the most-used non-neutral hex to --accent. Define --bg, --fg, --muted (60% opacity fg), --surface, --accent, --accent-fg.
26. Same --var names on every page.

## Content
27. Home: a hero that fits the chosen archetype (NOT necessarily centered + two CTAs), then 2-5 sections that reflect THIS business's actual offerings — not a generic "overview cards" grid. Mix section types: long-form editorial passages, image-led spreads, single-column copy with a pull-quote, ranked lists, two-column splits. The home page is a magazine cover for this business, not a Squarespace template.
28. About: lift 1-2 phrases from scraped About copy. Do NOT invent biography.
29. Services/treatments/menu: prefer scraped items verbatim. If fewer than 3, supplement with fallback_intel — but ONLY if scraped is empty. Vary how the items are presented: a numbered editorial list, an asymmetric staggered grid, a tabbed deep-dive, a single hero feature with smaller cards beneath. NEVER 3-equal-cards as the default.
30. Gallery (if present): responsive image grid, lazy-loaded — but vary the grid (mix wide and tall tiles, or use a horizontal scroller, or a single-row marquee).
31. Contact: phone/email/address as scraped, <a href="tel:...">, <a href="mailto:...">. If bookingUrl scraped, show a big "Book now" button targeting it with target="_blank" rel="noopener". Map iframe from OpenStreetMap (not Google Maps) with the address query.
32. Testimonials: render at most 2 per page, verbatim, attributed as "Verified Google review". Never fabricate reviewer names.
33. Footer: copyright year = ${i.current_year}. Business name. Social icons from scraped socials only. Short "About" sentence. Sibling page links.

## Differentiation self-check (before you output)
Before returning the JSON, mentally compare your draft to the most obvious "default
${i.niche} website" you can imagine. If your hero/practice-areas/contact structure
matches what 80% of ${i.niche} sites already do, REWRITE the home page using the
chosen archetype. The reviewer is checking specifically for "this looks different
from the last 5 ${i.niche}s I saw".

## CTAs (MUST actually work)
34. Primary CTA on home hero → bookingUrl if present (external, target=_blank rel=noopener), else contact.html#book.
35. Every "Book", "Reserve", "Get in touch" button points to a real target: tel:, mailto:, bookingUrl, or contact.html#book.
36. In-page anchor hrefs ("#id") MUST only reference IDs that exist on the SAME page. Do not sprinkle dead #book links on pages that don't contain #book.
37. No links to this business's current live domain. None. Period.

## Style / tone
38. No em-dashes (—) or en-dashes (–). Use commas or periods.
39. No "Lorem ipsum". No placeholder text. Every string is grounded in the business.
40. No agency pitch, no "designed by", no "book a call" to anyone other than the business itself. The outreach pitch is added separately as an overlay — do not include it.
41. No emojis unless they match the niche tone. Prefer inline SVG or none.
42. Layout variety — DO NOT default to a three-equal-cards grid. Vary: asymmetric splits, image-left-copy-right, full-bleed photo bands, editorial pull-quotes.

## Size
43. Each page ≥ 2200 characters and ≤ 5500 characters. Total combined output (across all pages, JSON included) MUST stay under 16000 characters or it will be truncated. Be tight — quality over volume.

</hard_requirements>

<quality_bar>
- The owner recognizes their content instantly: their images, language, services, palette.
- Feels like an award-winning small-studio multi-page redesign, not a Wix/Squarespace template.
- Whitespace, typography, imagery hierarchy. Don't cram.
- Navigation feels like a real site — clicking links moves between real pages with shared chrome.
- Contact is about THEM, not us.
</quality_bar>

Return ONLY the JSON object, beginning with {.`,
};
