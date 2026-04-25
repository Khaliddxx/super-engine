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
  version: "2.0",
  deployedAt: "2026-04-26",
  render: (i: RedesignInput) => `You are a senior product designer building a full, production-quality website redesign for a local business.
This is NOT a template fill-in. It is a bespoke redesign using THE BUSINESS'S OWN ASSETS (their real photos, videos, logo, brand colors).
The business owner will see this preview in a cold outreach message. It must feel like you actually studied their site — because you did.

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
2. Begin output with exactly: <!DOCTYPE html>
3. Output ONLY the HTML — no markdown fences, no prose, no commentary.
4. Mobile responsive (breakpoint at 768px). Mobile-first layout.
5. Use their real images/videos directly — do NOT render CSS gradient blocks where an image URL is available. Hero must use either heroVideo (autoplay muted loop playsinline) or heroImage as an actual media element, not a background gradient.
6. Logo in nav: if logo URL present, use <img src="${i.assets.logo ?? ""}"> at 40px height; otherwise render the business name as a serif wordmark.
7. Brand palette: derive CSS variables from the scraped brand colors. Map the most-used non-neutral hex to --accent. Use --bg (near-white or near-black depending on mood), --fg (high-contrast text), --muted (60% opacity fg), --surface (subtle card bg).
8. Typography: if brand fonts were detected, import them from Google Fonts at the top of <head>. Otherwise pick a tasteful modern pairing (one serif display + one sans body).
9. Required sections, in order: <nav>, <section id="hero">, <section id="services">, <section id="about">, <section id="gallery"> (only if 3+ images), <section id="testimonials"> (only if testimonials scraped), <section id="book">, <footer>.
10. #book section MUST contain the agency contact above as:
    - name text
    - email as <a href="mailto:...">
    - phone as <a href="tel:...">
11. Every button with class "btn-primary" must have href="#book".
12. Services grid: prefer scraped services verbatim. If fewer than 3, supplement with vertical_intel fallback descriptions but adapt them to this business's voice.
13. About section: lift 1–2 phrases from the scraped About copy verbatim (in quotes if appropriate). Do NOT invent biography.
14. Testimonials: if present, render 2 max, verbatim, with a generic attribution like "Verified Google review" (never fabricate reviewer names).
15. Footer: copyright year MUST be ${i.current_year} (not any other year).
16. No em-dashes (—) or en-dashes (–) anywhere in visible text. Use commas or periods instead.
17. No "Lorem ipsum". No placeholder text. Every string is grounded in the business.
18. No external JS. CSS goes in a single <style> block in <head>. One optional small inline script is fine for nav toggle if needed.
19. Minimum document length: 8000 characters. Aim for a full, rich page.
20. No raw URLs from other websites (stock photos). Only use URLs listed in <real_assets> or Google Fonts.
</hard_requirements>

<quality_bar>
- The owner should recognize their own content instantly — their images, their language, their services, their palette.
- It should feel like an award-winning small-studio redesign, not a Squarespace template.
- Whitespace, typography, and imagery hierarchy matter. Don't cram.
- If there's a hero video, it should autoplay muted, cover the hero, with a subtle dark overlay so text is readable.
- Do NOT use emoji icons unless they match the niche tone. Prefer clean inline SVG or none.
</quality_bar>

Begin output with <!DOCTYPE html>.`,
};
