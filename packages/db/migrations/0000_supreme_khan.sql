CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"niche" varchar(64) NOT NULL,
	"target_city" text,
	"target_country" varchar(2),
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"max_prospects" integer DEFAULT 200 NOT NULL,
	"outreach_channel" varchar(16) DEFAULT 'linkedin' NOT NULL,
	"imagery_strategy" varchar(16) DEFAULT 'none' NOT NULL,
	"auto_send_enabled" boolean DEFAULT false NOT NULL,
	"auto_approve_categories" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"vercel_deployment_id" text,
	"url" text NOT NULL,
	"html_content" text,
	"variant_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_run_id" uuid NOT NULL,
	"country" varchar(2) NOT NULL,
	"niche" varchar(64) NOT NULL,
	"city" text NOT NULL,
	"business_count" integer,
	"avg_rating" numeric(2, 1),
	"total_reviews" integer,
	"pct_with_website" numeric(3, 2),
	"pct_outdated_estimate" numeric(3, 2),
	"opportunity_score" numeric(6, 2),
	"niche_ticket_weight" numeric(3, 2),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"direction" varchar(8) NOT NULL,
	"channel" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"subject" text,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"external_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_email" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Amsterdam' NOT NULL,
	"notification_channels" jsonb,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"auto_send_rules" jsonb,
	"linkedin_daily_cap" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_settings_operator_email_unique" UNIQUE("operator_email")
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"state" varchar(32) DEFAULT 'NEW' NOT NULL,
	"business_name" text NOT NULL,
	"niche" varchar(64) NOT NULL,
	"city" text,
	"country" varchar(2),
	"website" text,
	"email" text,
	"phone" text,
	"linkedin_url" text,
	"linkedin_provider_id" text,
	"linkedin_chat_id" text,
	"linkedin_invitation_id" text,
	"linkedin_invitation_sent_at" timestamp with time zone,
	"linkedin_invitation_accepted_at" timestamp with time zone,
	"google_place_id" text,
	"rating" numeric(2, 1),
	"review_count" integer,
	"timezone" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"scraped_services" text[],
	"scraped_copy" text,
	"detected_year" integer,
	"qualification_score" numeric(3, 2),
	"qualification_reasoning" text,
	"qualification_issues" text[],
	"rejection_reason" text,
	"screenshot_url" text,
	"variant_palette" varchar(64),
	"variant_fonts" varchar(64),
	"variant_layout" varchar(64),
	"redesign_html_url" text,
	"redesign_deployed_at" timestamp with time zone,
	"first_sent_at" timestamp with time zone,
	"last_touched_at" timestamp with time zone,
	"outcome" varchar(32),
	"outcome_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospects_google_place_id_unique" UNIQUE("google_place_id")
);
--> statement-breakpoint
CREATE TABLE "send_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"channel" varchar(16) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"external_ref" text,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"from_state" varchar(32),
	"to_state" varchar(32) NOT NULL,
	"reason" text,
	"triggered_by" varchar(32),
	"triggered_by_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"channel" varchar(16) NOT NULL,
	"external_thread_id" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"kind" varchar(24) DEFAULT 'reply' NOT NULL,
	"classification" varchar(32),
	"confidence" numeric(3, 2),
	"summary" text,
	"draft_response" text,
	"reasoning" text,
	"priority" varchar(8),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"operator_note" text,
	"edited_response" text,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "vertical_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niche" varchar(64) NOT NULL,
	"tagline" text NOT NULL,
	"hero_subtitle_style" text NOT NULL,
	"primary_cta" text NOT NULL,
	"secondary_cta" text NOT NULL,
	"services" jsonb NOT NULL,
	"extra_section_title" text,
	"extra_section_items" jsonb,
	"suggested_imagery_strategy" varchar(16),
	"suggested_palettes" text[],
	"suggested_fonts" text[],
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vertical_templates_niche_unique" UNIQUE("niche")
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_log" ADD CONSTRAINT "send_log_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_transitions" ADD CONSTRAINT "state_transitions_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage" ADD CONSTRAINT "triage_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage" ADD CONSTRAINT "triage_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scans_score" ON "market_scans" USING btree ("scan_run_id","opportunity_score");--> statement-breakpoint
CREATE INDEX "idx_messages_thread" ON "messages" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_messages_external" ON "messages" USING btree ("channel","external_message_id");--> statement-breakpoint
CREATE INDEX "idx_prospects_state" ON "prospects" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_prospects_campaign" ON "prospects" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_prospects_last_touched" ON "prospects" USING btree ("last_touched_at");--> statement-breakpoint
CREATE INDEX "idx_send_log_prospect" ON "send_log" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "idx_send_log_sent_at" ON "send_log" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "idx_transitions_prospect" ON "state_transitions" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "idx_threads_prospect" ON "threads" USING btree ("prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_threads_external" ON "threads" USING btree ("channel","external_thread_id");--> statement-breakpoint
CREATE INDEX "idx_triage_status" ON "triage" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_triage_priority" ON "triage" USING btree ("priority","status");