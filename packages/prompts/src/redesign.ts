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

export interface RedesignInput {
  name: string;
  niche: string;
  city: string;
  scraped_services: string[];
  scraped_copy: string;
  scraped_about_copy?: string;
  scraped_testimonials?: string[];
  scraped_pages_summary?: string;
  assets: RedesignAssets;
  years: string;
  current_year: number;
  template_primary_cta: string;
  template_secondary_cta: string;
  template_tagline: string;
  template_services: Array<{ name: string; desc: string }>;
  operator_name: string;
  operator_email: string;
  operator_phone: string;
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

export const REDESIGN_PROMPT_V2 = {
  version: "2.1",
  deployedAt: "2026-04-26",
  render: (i: RedesignInput) => `You are a senior product designer building a full, production-quality, MOBILE-FIRST website redesign for a local business.
This is NOT a template fill-in. It is a bespoke redesign using THE BUSINESS'S OWN ASSETS (their real photos, videos, logo, brand colors).
The business owner will see this preview on their phone in a cold outreach message. It must feel like you actually studied their site, because you did.

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

<real_assets>
These are the business's OWN assets scraped from their live site. USE THEM.

Logo URL: ${i.assets.logo ?? "(none — use a clean wordmark of the business name in the brand font)"}
Favicon URL: ${i.assets.favicon ?? "(none)"}
Hero image URL: ${i.assets.heroImage ?? "(none)"}
Hero video URL: ${i.assets.heroVideo ?? "(none)"}
OG image URL: ${i.assets.ogImage ?? "(none)"}

All image URLs available (use these directly as src="..."):
${list(i.assets.images, 20)}

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

<contact_block>
This is the REDESIGN AGENCY's contact (not the business's). Put this in #book.
Name: ${i.operator_name}
Email: ${i.operator_email}
Phone: ${i.operator_phone}
</contact_block>

<hard_requirements>
1. Output a SINGLE self-contained HTML document, everything inline.
2. Begin output with exactly: <!DOCTYPE html>.
3. Output ONLY the HTML. No markdown fences, no prose, no commentary.
4. <head> MUST include: <meta charset="utf-8"> and <meta name="viewport" content="width=device-width, initial-scale=1">.
5. MOBILE-FIRST CSS:
   - Base styles target a 375px viewport. Desktop styles go inside @media (min-width: 768px).
   - No fixed widths in px on containers, only max-width. Use fluid type (clamp() for h1/h2).
   - Hero at 375px wide must have readable headline (no clipped text, no horizontal scroll).
   - Nav collapses to a simple stack or hamburger at <768px. Never require scroll-horizontally.
   - Tap targets are at least 44x44px.
   - Test: if you wrote width:100vw anywhere, rewrite it. If you wrote a px width > 375 without max-width, rewrite it.
6. USE REAL ASSETS. Do not render CSS gradient placeholder blocks when image URLs are provided.
   - Hero section: if heroVideo present, use <video autoplay muted loop playsinline> with a subtle dark overlay for text legibility. Else if heroImage present, use <img> as a full-bleed element. Only if BOTH are absent may you do a typographic hero (oversized display headline, no fake-image gradient box).
   - Services / about / gallery: embed at least 3 of the provided image URLs as actual <img src="..."> elements when 3+ images are available.
   - Logo in nav: if logo URL present, use <img src="${i.assets.logo ?? ""}" alt="${i.name}"> at ~36-44px height. Else render the business name as a wordmark in the display font.
7. BRAND PALETTE:
   - Derive CSS variables from brandColors: map the most-used non-neutral hex to --accent.
   - Define --bg, --fg, --muted (60% opacity fg), --surface, --accent, --accent-fg.
   - If no brandColors were detected, use a tasteful neutral palette keyed off the niche (warm cream + charcoal for restaurants, cool slate + sage for medical, etc.).
8. TYPOGRAPHY:
   - If brand fonts were detected, import them from fonts.googleapis.com at the top of <head>.
   - Else pick a considered pairing (e.g. Fraunces + Inter, Playfair Display + Nunito).
9. LAYOUT VARIETY — DO NOT default to the standard three-equal-cards-services-grid Squarespace shape. Choose a layout that fits this business:
   - Hospitality / venue / restaurant: full-bleed hero image, asymmetric copy, editorial feel.
   - Medical / dental / professional: calm two-column hero, clear credentials strip, booking CTA sticky.
   - Retail / cafe / local service: photo-driven, offer-led, strong local cue.
10. REQUIRED SECTIONS, in order:
    <nav>, <section id="hero">, <section id="services">, <section id="about">,
    <section id="gallery"> (include ONLY if 3+ images available in <real_assets>),
    <section id="testimonials"> (include ONLY if testimonials scraped),
    <section id="book">, <footer>.
11. #book section MUST contain the agency contact (from contact_block) as:
    - plain name text
    - email as <a href="mailto:...">
    - phone as <a href="tel:...">
12. Every button with class "btn-primary" must have href="#book".
13. Services grid: prefer scraped services verbatim. If fewer than 3, supplement with vertical_intel fallback descriptions, adapted to this business's voice.
14. About: lift 1-2 phrases from the scraped About copy. Do NOT invent biography.
15. Testimonials: render at most 2, verbatim, attributed as "Verified Google review" (never fabricate reviewer names).
16. Footer copyright year MUST be ${i.current_year}. Not any other year.
17. No em-dashes (—) or en-dashes (–) anywhere in visible text.
18. No "Lorem ipsum". No placeholder text.
19. No external JS. One small inline <script> only if needed for a nav toggle.
20. Minimum document length: 9000 characters. Aim for a full, rich, editorial page.
21. No stock image URLs from other sites. Only use URLs listed in <real_assets> or Google Fonts.
</hard_requirements>

<quality_bar>
- The owner should recognize their own content instantly: their images, their language, their services, their palette.
- This should feel like an award-winning small-studio redesign, not a Wix or Squarespace template.
- Whitespace, typography, and imagery hierarchy matter. Don't cram.
- If there's a hero video, it must autoplay muted loop, cover the hero, with a subtle dark overlay so headline text is readable.
- Do NOT use emoji icons unless they match the niche tone. Prefer clean inline SVG or none.
- No "rounded-xl card with an emoji and a sentence" stack. Vary the shapes: asymmetric splits, image-left-copy-right, full-bleed photo sections, editorial-style pull-quotes.
</quality_bar>

Begin output with <!DOCTYPE html>.`,
};
