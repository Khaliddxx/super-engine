ALTER TABLE "prospects" ADD COLUMN "scraped_about_copy" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "scraped_testimonials" text[];--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "scraped_pages" jsonb;