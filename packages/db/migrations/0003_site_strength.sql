ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "scraped_sitemap" jsonb;
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "site_strength_score" numeric(4, 1);
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "site_strength_signals" jsonb;
