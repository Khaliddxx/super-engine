ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "auto_redesign_after_enrich" boolean DEFAULT true NOT NULL;
