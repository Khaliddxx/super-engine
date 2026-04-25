import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────
//  States — see SPEC §3
// ─────────────────────────────────────────────
export const PROSPECT_STATES = [
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
] as const;
export type ProspectState = (typeof PROSPECT_STATES)[number];

// ─────────────────────────────────────────────
//  campaigns
// ─────────────────────────────────────────────
export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  niche: varchar("niche", { length: 64 }).notNull(),
  targetCity: text("target_city"),
  targetCountry: varchar("target_country", { length: 2 }),
  status: varchar("status", { length: 32 }).default("active").notNull(), // active | paused | complete
  maxProspects: integer("max_prospects").default(200).notNull(),

  outreachChannel: varchar("outreach_channel", { length: 16 }).default("linkedin").notNull(), // email | linkedin | both
  imageryStrategy: varchar("imagery_strategy", { length: 16 }).default("none").notNull(),
  autoSendEnabled: boolean("auto_send_enabled").default(false).notNull(),
  autoApproveCategories: text("auto_approve_categories").array(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────
//  prospects
// ─────────────────────────────────────────────
export const prospects = pgTable(
  "prospects",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    state: varchar("state", { length: 32 }).default("NEW").notNull(),

    businessName: text("business_name").notNull(),
    niche: varchar("niche", { length: 64 }).notNull(),
    city: text("city"),
    country: varchar("country", { length: 2 }),

    website: text("website"),
    email: text("email"),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),

    // LinkedIn-specific (Unipile identifiers)
    linkedinProviderId: text("linkedin_provider_id"),
    linkedinChatId: text("linkedin_chat_id"),
    linkedinInvitationId: text("linkedin_invitation_id"),
    linkedinInvitationSentAt: timestamp("linkedin_invitation_sent_at", { withTimezone: true }),
    linkedinInvitationAcceptedAt: timestamp("linkedin_invitation_accepted_at", { withTimezone: true }),

    // Places API
    googlePlaceId: text("google_place_id").unique(),
    rating: numeric("rating", { precision: 2, scale: 1 }),
    reviewCount: integer("review_count"),
    timezone: text("timezone"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),

    // enrichment
    scrapedServices: text("scraped_services").array(),
    scrapedCopy: text("scraped_copy"),
    scrapedAboutCopy: text("scraped_about_copy"),
    scrapedTestimonials: text("scraped_testimonials").array(),
    scrapedPages: jsonb("scraped_pages"), // Array<{ url, title, length }>
    detectedYear: integer("detected_year"),

    // qualification
    qualificationScore: numeric("qualification_score", { precision: 3, scale: 2 }),
    qualificationReasoning: text("qualification_reasoning"),
    qualificationIssues: text("qualification_issues").array(),
    rejectionReason: text("rejection_reason"),
    screenshotUrl: text("screenshot_url"),

    // redesign
    variantPalette: varchar("variant_palette", { length: 64 }),
    variantFonts: varchar("variant_fonts", { length: 64 }),
    variantLayout: varchar("variant_layout", { length: 64 }),
    redesignHtmlUrl: text("redesign_html_url"),
    redesignDeployedAt: timestamp("redesign_deployed_at", { withTimezone: true }),

    firstSentAt: timestamp("first_sent_at", { withTimezone: true }),
    lastTouchedAt: timestamp("last_touched_at", { withTimezone: true }),

    outcome: varchar("outcome", { length: 32 }),
    outcomeReason: text("outcome_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    stateIdx: index("idx_prospects_state").on(t.state),
    campaignIdx: index("idx_prospects_campaign").on(t.campaignId),
    lastTouchedIdx: index("idx_prospects_last_touched").on(t.lastTouchedAt),
  }),
);

// ─────────────────────────────────────────────
//  threads
// ─────────────────────────────────────────────
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 16 }).notNull(), // email | linkedin
    externalThreadId: text("external_thread_id"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    prospectIdx: index("idx_threads_prospect").on(t.prospectId),
    externalUniq: uniqueIndex("idx_threads_external").on(t.channel, t.externalThreadId),
  }),
);

// ─────────────────────────────────────────────
//  messages
// ─────────────────────────────────────────────
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    direction: varchar("direction", { length: 8 }).notNull(), // out | in
    channel: varchar("channel", { length: 16 }).notNull(),
    content: text("content").notNull(),
    subject: text("subject"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    externalMessageId: text("external_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    threadIdx: index("idx_messages_thread").on(t.threadId),
    externalUniq: uniqueIndex("idx_messages_external").on(t.channel, t.externalMessageId),
  }),
);

// ─────────────────────────────────────────────
//  triage
// ─────────────────────────────────────────────
export const triage = pgTable(
  "triage",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    messageId: uuid("message_id")
      .notNull()
      .unique()
      .references(() => messages.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),

    kind: varchar("kind", { length: 24 }).default("reply").notNull(), // reply | first_dm_after_accept
    classification: varchar("classification", { length: 32 }),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    summary: text("summary"),
    draftResponse: text("draft_response"),
    reasoning: text("reasoning"),
    priority: varchar("priority", { length: 8 }),

    status: varchar("status", { length: 16 }).default("pending").notNull(), // pending | approved | edited | rejected | auto_sent | sent
    operatorNote: text("operator_note"),
    editedResponse: text("edited_response"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index("idx_triage_status").on(t.status),
    priorityStatusIdx: index("idx_triage_priority").on(t.priority, t.status),
  }),
);

// ─────────────────────────────────────────────
//  state_transitions (append-only audit)
// ─────────────────────────────────────────────
export const stateTransitions = pgTable(
  "state_transitions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    fromState: varchar("from_state", { length: 32 }),
    toState: varchar("to_state", { length: 32 }).notNull(),
    reason: text("reason"),
    triggeredBy: varchar("triggered_by", { length: 32 }),
    triggeredById: text("triggered_by_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    prospectIdx: index("idx_transitions_prospect").on(t.prospectId),
  }),
);

// ─────────────────────────────────────────────
//  deployments
// ─────────────────────────────────────────────
export const deployments = pgTable("deployments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  prospectId: uuid("prospect_id")
    .notNull()
    .references(() => prospects.id, { onDelete: "cascade" }),
  vercelDeploymentId: text("vercel_deployment_id"),
  url: text("url").notNull(),
  htmlContent: text("html_content"),
  variantJson: jsonb("variant_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────
//  market_scans
// ─────────────────────────────────────────────
export const marketScans = pgTable(
  "market_scans",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    scanRunId: uuid("scan_run_id").notNull(),
    country: varchar("country", { length: 2 }).notNull(),
    niche: varchar("niche", { length: 64 }).notNull(),
    city: text("city").notNull(),
    businessCount: integer("business_count"),
    avgRating: numeric("avg_rating", { precision: 2, scale: 1 }),
    totalReviews: integer("total_reviews"),
    pctWithWebsite: numeric("pct_with_website", { precision: 3, scale: 2 }),
    pctOutdatedEstimate: numeric("pct_outdated_estimate", { precision: 3, scale: 2 }),
    opportunityScore: numeric("opportunity_score", { precision: 6, scale: 2 }),
    nicheTicketWeight: numeric("niche_ticket_weight", { precision: 3, scale: 2 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    scoreIdx: index("idx_scans_score").on(t.scanRunId, t.opportunityScore),
  }),
);

// ─────────────────────────────────────────────
//  vertical_templates
// ─────────────────────────────────────────────
export const verticalTemplates = pgTable("vertical_templates", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  niche: varchar("niche", { length: 64 }).notNull().unique(),
  tagline: text("tagline").notNull(),
  heroSubtitleStyle: text("hero_subtitle_style").notNull(),
  primaryCta: text("primary_cta").notNull(),
  secondaryCta: text("secondary_cta").notNull(),
  services: jsonb("services").notNull(), // Array<{name, desc}>
  extraSectionTitle: text("extra_section_title"),
  extraSectionItems: jsonb("extra_section_items"), // Array<{heading, body}>
  suggestedImageryStrategy: varchar("suggested_imagery_strategy", { length: 16 }),
  suggestedPalettes: text("suggested_palettes").array(),
  suggestedFonts: text("suggested_fonts").array(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────
//  operator_settings
// ─────────────────────────────────────────────
export const operatorSettings = pgTable("operator_settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  operatorEmail: text("operator_email").unique().notNull(),
  timezone: text("timezone").default("Europe/Amsterdam").notNull(),
  notificationChannels: jsonb("notification_channels"),
  quietHoursStart: time("quiet_hours_start"),
  quietHoursEnd: time("quiet_hours_end"),
  autoSendRules: jsonb("auto_send_rules"),
  linkedinDailyCap: integer("linkedin_daily_cap").default(10).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────
//  send_log — rate limits, sends-per-day counters
// ─────────────────────────────────────────────
export const sendLog = pgTable(
  "send_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 16 }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull(), // invite | dm | email_initial | followup_1 | triage_reply
    status: varchar("status", { length: 16 }).notNull(), // queued | sent | failed | deferred_send_window | deferred_cap
    externalRef: text("external_ref"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    prospectIdx: index("idx_send_log_prospect").on(t.prospectId),
    sentAtIdx: index("idx_send_log_sent_at").on(t.sentAt),
  }),
);

// ─────────────────────────────────────────────
//  types
// ─────────────────────────────────────────────
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Prospect = typeof prospects.$inferSelect;
export type NewProspect = typeof prospects.$inferInsert;
export type Thread = typeof threads.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Triage = typeof triage.$inferSelect;
export type StateTransition = typeof stateTransitions.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type MarketScan = typeof marketScans.$inferSelect;
export type VerticalTemplate = typeof verticalTemplates.$inferSelect;
export type OperatorSettings = typeof operatorSettings.$inferSelect;
export type SendLogEntry = typeof sendLog.$inferSelect;
