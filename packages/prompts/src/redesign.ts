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
  template_primary_cta: string;
  template_secondary_cta: string;
  template_tagline: string;
  template_services: Array<{ name: string; desc: string }>;
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
 * REDESIGN V2.2
 *
 * Changes vs V2.1:
 *  - MULTI-PAGE: output is now a JSON object `{ pages: [{ slug, html }...] }`
 *    mirroring the prospect's actual sitemap. Each page shares a nav/footer.
 *  - No agency contact in the HTML. The agency pitch is added later as a
 *    deploy-time overlay on top of the rendered site; the generated HTML
 *    must only contain the BUSINESS's info (phone, email, booking URL).
 *  - Stricter anchor rules: every in-page `#hash` target must exist, every
 *    cross-page link must be to one of the generated slugs, no outbound
 *    links to the business's current domain.
 *  - Explicit navbar spec (logo left, links right, consistent gaps, mobile
 *    hamburger below 768px, no horizontal overflow).
 */
export const REDESIGN_PROMPT_V2 = {
  version: "2.2",
  deployedAt: "2026-04-26",
  render: (i: RedesignInput) => `You are a senior product designer building a production-quality, MOBILE-FIRST, MULTI-PAGE website redesign for a local business.
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

<sitemap_to_generate>
Generate these pages, in order. Each page must share the SAME nav and footer markup, but each page's main content differs by page type:
${sitemapBlock(i.sitemap)}

Page-type conventions:
- index.html (home) — hero + mini-summaries linking to each other page + booking CTA + 1 social-proof strip
- about.html — story, team, values, visuals. Use scraped about copy verbatim where possible.
- services.html / treatments.html — full list of services/treatments with real or adapted descriptions
- menu.html — itemized list of dishes/drinks if scraped, otherwise categorized sections
- rooms.html — room/venue/space tiles with imagery
- gallery.html — image grid using the real scraped images
- team.html — team members (if scraped names are available; otherwise skip)
- contact.html — phone, email, address, map iframe (OpenStreetMap), booking widget link if provided
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

<vertical_intel>
Tagline direction: ${i.template_tagline}
Primary CTA label: ${i.template_primary_cta}
Secondary CTA label: ${i.template_secondary_cta}
Fallback service descriptions if scraped list is sparse:
${JSON.stringify(i.template_services)}
</vertical_intel>

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
27. Home: short hero headline (≤ 10 words), one-sentence subhead, a primary CTA and a secondary CTA, then 2-4 "overview cards" each linking to a sibling page. Include a social-proof strip (testimonials block) if testimonials were scraped.
28. About: lift 1-2 phrases from scraped About copy. Do NOT invent biography.
29. Services/treatments/menu: prefer scraped items verbatim. If fewer than 3, supplement with vertical_intel fallback adapted to this business's voice.
30. Gallery (if present): responsive image grid, lazy-loaded.
31. Contact: phone/email/address as scraped, <a href="tel:...">, <a href="mailto:...">. If bookingUrl scraped, show a big "Book now" button targeting it with target="_blank" rel="noopener". Map iframe from OpenStreetMap (not Google Maps) with the address query.
32. Testimonials: render at most 2 per page, verbatim, attributed as "Verified Google review". Never fabricate reviewer names.
33. Footer: copyright year = ${i.current_year}. Business name. Social icons from scraped socials only. Short "About" sentence. Sibling page links.

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
43. Minimum combined length across all pages: 12000 characters. Each page ≥ 3500 characters.

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
