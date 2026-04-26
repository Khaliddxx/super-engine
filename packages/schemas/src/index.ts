import { z } from "zod";

// ─────────────────────────────────────────────
//  State machine
// ─────────────────────────────────────────────
export const ProspectStateSchema = z.enum([
  "NEW",
  "ENRICHED",
  "QUALIFIED",
  "REJECTED",
  "REDESIGNED",
  "APPROVED_TO_SEND",
  "SENT",
  "AWAITING",
  "RESPONDED",
  "FOLLOWUP_1",
  "FOLLOWUP_2",
  "BOOKED",
  "WON",
  "LOST",
]);
export type ProspectState = z.infer<typeof ProspectStateSchema>;

export const TriageClassificationSchema = z.enum([
  "booking",
  "hot",
  "warm",
  "objection",
  "notnow",
  "unsub",
  "human",
]);
export type TriageClassification = z.infer<typeof TriageClassificationSchema>;

export const TriagePrioritySchema = z.enum(["high", "medium", "low"]);
export type TriagePriority = z.infer<typeof TriagePrioritySchema>;

// ─────────────────────────────────────────────
//  Prompt outputs — parse after LLM call
// ─────────────────────────────────────────────
export const QualifyResultSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(5),
  dimension_scores: z.object({
    visual: z.number(),
    hierarchy: z.number(),
    mobile: z.number(),
    trust: z.number(),
    conversion: z.number(),
  }),
  reasoning: z.string(),
  top_issues: z.array(z.string()),
});
export type QualifyResult = z.infer<typeof QualifyResultSchema>;

export const RedesignQualityAuditSchema = z.object({
  pass: z.boolean(),
  original_score: z.number().min(0).max(10),
  redesign_score: z.number().min(0).max(10),
  delta: z.number(),
  verdict: z.string(),
  fatal_issues: z.array(z.string()),
  better_than_original: z.array(z.string()),
  repair_instruction: z.string(),
});
export type RedesignQualityAudit = z.infer<typeof RedesignQualityAuditSchema>;

export const TemplateServiceSchema = z.object({
  name: z.string(),
  desc: z.string(),
});

export const TemplateExtraItemSchema = z.object({
  heading: z.string(),
  body: z.string(),
});

export const VerticalTemplateSchema = z.object({
  tagline: z.string(),
  heroSubtitleStyle: z.string(),
  primaryCTA: z.string(),
  secondaryCTA: z.string(),
  services: z.array(TemplateServiceSchema).min(3).max(3),
  extraSectionTitle: z.string(),
  extraSectionItems: z.array(TemplateExtraItemSchema).min(3).max(3),
  suggestedImageryStrategy: z.enum(["none", "scraped", "stock", "generated"]),
  suggestedPalettes: z.array(z.string()),
  suggestedFonts: z.array(z.string()),
});
export type VerticalTemplateJson = z.infer<typeof VerticalTemplateSchema>;

export const OutreachMessageSchema = z.object({
  subject: z.string().optional(),
  body: z.string(),
});
export type OutreachMessage = z.infer<typeof OutreachMessageSchema>;

export const TriageResultSchema = z.object({
  classification: TriageClassificationSchema,
  confidence: z.number().min(0).max(1),
  priority: TriagePrioritySchema,
  summary: z.string(),
  draft_response: z.string().nullable(),
  reasoning: z.string(),
});
export type TriageResult = z.infer<typeof TriageResultSchema>;

// ─────────────────────────────────────────────
//  Design variants
// ─────────────────────────────────────────────
export const PaletteSchema = z.object({
  name: z.string(),
  bg: z.string(),
  fg: z.string(),
  accent: z.string(),
  muted: z.string(),
  surface: z.string(),
});
export type Palette = z.infer<typeof PaletteSchema>;

export const FontPairSchema = z.object({
  name: z.string(),
  heading: z.string(),
  body: z.string(),
  style: z.string(),
});
export type FontPair = z.infer<typeof FontPairSchema>;

export const LayoutVariantSchema = z.enum([
  "hero-split",
  "hero-centered",
  "hero-asymmetric",
  "hero-editorial",
]);
export type LayoutVariant = z.infer<typeof LayoutVariantSchema>;

// ─────────────────────────────────────────────
//  Pipeline DTOs
// ─────────────────────────────────────────────
export const TransitionResultSchema = z.object({
  prospectId: z.string().uuid(),
  fromState: ProspectStateSchema.optional(),
  toState: ProspectStateSchema,
  reason: z.string().optional(),
});
export type TransitionResult = z.infer<typeof TransitionResultSchema>;

// ─────────────────────────────────────────────
//  Env schema (orchestrator)
// ─────────────────────────────────────────────
export const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  PORT: z.coerce.number().default(3001),

  OPERATOR_NAME: z.string().default("Operator"),
  OPERATOR_EMAIL: z.string().email().optional().or(z.literal("")),
  OPERATOR_PHONE: z.string().optional().or(z.literal("")),

  // Studio / agency overlay shown on top of the generated business site.
  // These appear only in the floating banner, never inside the business HTML.
  STUDIO_DISPLAY_NAME: z.string().default("Independent design studio"),
  STUDIO_BOOKING_URL: z.string().url().optional().or(z.literal("")),
  STUDIO_TAGLINE: z.string().default("We rebuilt this as a concept for you. Like it? 15 minutes, no pitch."),

  JWT_SECRET: z.string().min(16),
  OPERATOR_PASSWORD: z.string().min(4),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-"),
  CLAUDE_MODEL: z.string().default("claude-sonnet-4-5-20250929"),

  GOOGLE_PLACES_API_KEY: z.string().min(1),
  HUNTER_API_KEY: z.string().min(1),
  FIRECRAWL_API_KEY: z.string().min(1),

  VERCEL_TOKEN: z.string().min(1),
  VERCEL_TEAM_ID: z.string().optional().or(z.literal("")),

  UNIPILE_API_KEY: z.string().optional().or(z.literal("")),
  UNIPILE_DSN: z.string().optional().or(z.literal("")),
  UNIPILE_ACCOUNT_ID: z.string().optional().or(z.literal("")),
  LINKEDIN_DAILY_CAP: z.coerce.number().default(10),

  INSTANTLY_API_KEY: z.string().optional().or(z.literal("")),
  INSTANTLY_CAMPAIGN_ID: z.string().uuid().optional().or(z.literal("")),
  EMAIL_DAILY_CAP: z.coerce.number().default(25),
  SLACK_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
});
export type ServerEnv = z.infer<typeof ServerEnvSchema>;
