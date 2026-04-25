import { eq, type DbClient, verticalTemplates, type VerticalTemplate } from "@super-engine/db";
import { TEMPLATE_PROMPT_V1 } from "@super-engine/prompts";
import { VerticalTemplateSchema } from "@super-engine/schemas";
import { claudeText, extractJson } from "../integrations/claude.js";

export async function getOrCreateTemplate(db: DbClient, niche: string): Promise<VerticalTemplate> {
  const [existing] = await db.select().from(verticalTemplates).where(eq(verticalTemplates.niche, niche));
  if (existing) return existing;

  const raw = await claudeText(TEMPLATE_PROMPT_V1.render({ niche_name: niche }));
  const parsed = VerticalTemplateSchema.parse(extractJson(raw));

  const [row] = await db
    .insert(verticalTemplates)
    .values({
      niche,
      tagline: parsed.tagline,
      heroSubtitleStyle: parsed.heroSubtitleStyle,
      primaryCta: parsed.primaryCTA,
      secondaryCta: parsed.secondaryCTA,
      services: parsed.services,
      extraSectionTitle: parsed.extraSectionTitle,
      extraSectionItems: parsed.extraSectionItems,
      suggestedImageryStrategy: parsed.suggestedImageryStrategy,
      suggestedPalettes: parsed.suggestedPalettes,
      suggestedFonts: parsed.suggestedFonts,
    })
    .returning();

  if (!row) throw new Error("Failed to insert vertical template");
  return row;
}
