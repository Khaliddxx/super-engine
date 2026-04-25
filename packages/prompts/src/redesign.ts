export interface RedesignInput {
  name: string;
  niche: string;
  city: string;
  scraped_services: string[];
  scraped_copy: string;
  scraped_about_copy?: string;
  scraped_testimonials?: string[];
  scraped_pages_summary?: string;
  years: string;
  palette_json: string;
  fonts_json: string;
  layout_name: string;
  template_primary_cta: string;
  template_secondary_cta: string;
  template_tagline: string;
  template_hero_subtitle_style: string;
  template_services: Array<{ name: string; desc: string }>;
  template_extra_section_title: string;
  template_extra_section_items: Array<{ heading: string; body: string }>;
  operator_name: string;
  operator_email: string;
  operator_phone: string;
}

export const REDESIGN_PROMPT_V1 = {
  version: "1.0",
  deployedAt: "2026-04-26",
  render: (i: RedesignInput) => `You are generating a single-file HTML redesign for a local business website.
The output will be deployed as-is and shown to the business owner in a cold outreach message.
It must be polished, modern, and specific to their business.

<business>
Name: ${i.name}
Niche: ${i.niche}
City: ${i.city}
Services offered: ${i.scraped_services.join(", ") || "(none scraped — infer from niche)"}
Hero copy from current site: ${i.scraped_copy || "(none)"}
Years in business: ${i.years}
</business>

<design_system>
Palette: ${i.palette_json}
Fonts: ${i.fonts_json}
Layout: ${i.layout_name}
</design_system>

<vertical_template>
Tagline direction: ${i.template_tagline}
Hero subtitle style: ${i.template_hero_subtitle_style}
Primary CTA: ${i.template_primary_cta}
Secondary CTA: ${i.template_secondary_cta}
Required services: ${JSON.stringify(i.template_services)}
Extra section title: ${i.template_extra_section_title}
Extra section items: ${JSON.stringify(i.template_extra_section_items)}
</vertical_template>

<contact_block>
Contact person: ${i.operator_name}
Contact email: ${i.operator_email}
Contact phone: ${i.operator_phone}
</contact_block>

Hard requirements:
- Single HTML file, everything inline (CSS in <style>, no external JS)
- Import fonts from Google Fonts only
- Mobile responsive (breakpoint at 768px)
- Use the provided palette as CSS variables (--bg, --fg, --accent, --muted, --surface)
- Use the provided fonts for heading (serif) and body (sans)
- Include: nav, hero, services grid (3 cards matching template_services), extra info section (using extra_section), footer
- A <section id="book"> is REQUIRED. It must contain the contact person's name, email (as mailto: link), and phone (as tel: link) — NOT the business's own contact info. This is the redesign agency's contact.
- Every primary CTA (button class "btn-primary") must have href="#book"
- Business name must appear prominently in nav and hero
- Services must be specific — use the required services from the template, adapted with business-specific wording where the scraped info allows
- No stock image URLs (use CSS gradient visual blocks instead)
- Output nothing except the HTML document

Begin output with <!DOCTYPE html>.`,
};

export const REDESIGN_PROMPT_V1_1 = {
  version: "1.1",
  deployedAt: "2026-04-26",
  render: (i: RedesignInput) => `You are generating a single-file HTML redesign for a local business website.
The output will be deployed as-is and shown to the business owner in a cold outreach message.
It must be polished, modern, and SPECIFIC to this exact business — not a generic niche template.

<business>
Name: ${i.name}
Niche: ${i.niche}
City: ${i.city}
Years in business: ${i.years}

About (scraped from the live site):
${i.scraped_about_copy?.trim() || "(no About section scraped — infer conservatively from the hero copy below)"}

Hero / landing copy from current site:
${i.scraped_copy?.trim() || "(none scraped)"}

Services the site actually lists:
${i.scraped_services.length ? i.scraped_services.map((s) => `- ${s}`).join("\n") : "(none scraped — infer from niche)"}

Customer testimonials / quotes scraped from the site:
${(i.scraped_testimonials ?? []).length ? (i.scraped_testimonials ?? []).map((t) => `- "${t.replace(/"/g, "\\\"")}"`).join("\n") : "(none)"}

Pages crawled: ${i.scraped_pages_summary ?? "(homepage only)"}
</business>

<design_system>
Palette: ${i.palette_json}
Fonts: ${i.fonts_json}
Layout: ${i.layout_name}
</design_system>

<vertical_template>
Tagline direction: ${i.template_tagline}
Hero subtitle style: ${i.template_hero_subtitle_style}
Primary CTA: ${i.template_primary_cta}
Secondary CTA: ${i.template_secondary_cta}
Suggested services (use as fallback ONLY if scraped services are missing):
${JSON.stringify(i.template_services)}
Extra section title: ${i.template_extra_section_title}
Extra section items: ${JSON.stringify(i.template_extra_section_items)}
</vertical_template>

<contact_block>
Contact person: ${i.operator_name}
Contact email: ${i.operator_email}
Contact phone: ${i.operator_phone}
</contact_block>

Hard requirements:
- Single HTML file, everything inline (CSS in <style>, no external JS)
- Import fonts from Google Fonts only
- Mobile responsive (breakpoint at 768px)
- Use the provided palette as CSS variables (--bg, --fg, --accent, --muted, --surface)
- Use the provided fonts for heading (serif) and body (sans)
- Include: nav, hero, services grid, extra info section (using extra_section), footer
- Business name must appear prominently in nav and hero
- A <section id="book"> is REQUIRED. It must contain the contact person's name, email (as mailto: link), and phone (as tel: link) — NOT the business's own contact info. This is the redesign agency's contact.
- Every primary CTA (button class "btn-primary") must have href="#book"
- No stock image URLs (use CSS gradient visual blocks instead)
- Output nothing except the HTML document

Content specificity (these matter — the owner will recognize their site):
- Use the actual language from the About section above (not invented marketing copy). Lift 1–2 phrases verbatim where natural.
- Services grid: prefer the scraped services list — use exactly those names. Only fall back to the template's suggested services if the scraped list is empty.
- If testimonials are present, include 1–2 verbatim inside a <section id="testimonials"> (social-proof block). Do NOT fabricate testimonials.
- The hero headline should reference either the business's niche, city, or a distinctive phrase from the About copy — never generic filler like "Welcome to our business".

Begin output with <!DOCTYPE html>.`,
};
