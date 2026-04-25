export interface TemplateInput {
  niche_name: string;
}

export const TEMPLATE_PROMPT_V1 = {
  version: "1.0",
  deployedAt: "2026-04-26",
  render: (i: TemplateInput) => `You are defining a website template for a specific local business niche.
The template will be used to generate redesigned homepages for dozens of businesses in this niche.
It must capture what makes this niche distinctive — not just generic copy.

<niche>${i.niche_name}</niche>

Think about this niche like an experienced web designer would:
- What's the primary action a visitor takes? (book, call, request quote, reserve)
- What's the tone — warm and personal, urgent and technical, aspirational, trustworthy?
- What content sections do sites in this niche need?
- What services or offerings are typical at 3 tiers (entry, standard, premium)?
- What practical info do visitors actually look for (hours, pricing, location, credentials)?

Return a JSON object matching this exact shape (and nothing else — no preamble, no markdown):

{
  "tagline": "5-8 word tagline that captures the niche's essence. Ends with period.",
  "heroSubtitleStyle": "one-sentence description of how to phrase a hero subtitle for a business in this niche",
  "primaryCTA": "2-3 word primary action",
  "secondaryCTA": "2-3 word secondary action",
  "services": [
    { "name": "Entry-tier offering", "desc": "One sentence, 15-25 words, specific" },
    { "name": "Standard offering", "desc": "One sentence" },
    { "name": "Premium offering", "desc": "One sentence" }
  ],
  "extraSectionTitle": "Title of a second info section",
  "extraSectionItems": [
    { "heading": "Short heading", "body": "One sentence, specific, useful" },
    { "heading": "Short heading", "body": "One sentence" },
    { "heading": "Short heading", "body": "One sentence" }
  ],
  "suggestedImageryStrategy": "none | scraped | stock | generated",
  "suggestedPalettes": ["palette-hint-1", "palette-hint-2"],
  "suggestedFonts": ["font-hint-1", "font-hint-2"]
}

Rules:
- No generic placeholder copy like "Our services", "Contact us". Be specific to the niche.
- Don't invent fake credentials — those get filled in per-prospect later.
- Services should reflect what businesses in this niche actually sell.
- If the niche is broad, pick a common sub-specialty and note it in the tagline.

Return the JSON object only.`,
};
