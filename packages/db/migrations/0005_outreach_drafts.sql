-- Persist operator outreach drafts so pipeline detail survives navigation.
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "draft_linkedin_invite" text;
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "draft_email_subject" text;
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "draft_email_body" text;
