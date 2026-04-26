import cron from "node-cron";
import { type DbClient, campaigns, prospects, eq, and, gte, sql, count } from "@super-engine/db";
import { runPipelineCycle, runAutoSendPass } from "./modules/scheduler.js";
import { pollLinkedInInbox } from "./modules/inbox.js";
import { scrapeProspectsForCampaign } from "./modules/scrape.js";
import { logger } from "./lib/logger.js";

let running = { pipeline: false, inbox: false, scout: false };

/**
 * Daily auto-scout: walk every active campaign and re-run the Places scrape
 * to surface new outdated prospects. Dedupe by googlePlaceId means re-scraping
 * the same niche+city is safe — we only insert truly new businesses, so this
 * naturally drips fresh leads in over time.
 *
 * We cap at 5 campaigns per run to keep our Places quota usage predictable.
 * Campaigns are picked by lowest 7-day prospect count so quiet ones get
 * topped up first.
 */
async function runDailyAutoScout(db: DbClient): Promise<{ scrapedCampaigns: number; totalNew: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const activeCampaigns = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      niche: campaigns.niche,
      targetCity: campaigns.targetCity,
    })
    .from(campaigns)
    .where(eq(campaigns.status, "active"))
    .limit(50);

  if (activeCampaigns.length === 0) return { scrapedCampaigns: 0, totalNew: 0 };

  // Order by recent prospect count ascending so we top up quiet campaigns
  // first.
  const counts = await db
    .select({
      campaignId: prospects.campaignId,
      n: count(prospects.id).as("n"),
    })
    .from(prospects)
    .where(gte(prospects.createdAt, sevenDaysAgo))
    .groupBy(prospects.campaignId);
  const recentByCampaign = new Map(counts.map((r) => [r.campaignId, Number(r.n)]));

  const ranked = [...activeCampaigns].sort(
    (a, b) => (recentByCampaign.get(a.id) ?? 0) - (recentByCampaign.get(b.id) ?? 0),
  );
  const picks = ranked.slice(0, 5);

  let totalNew = 0;
  for (const c of picks) {
    try {
      const summary = await scrapeProspectsForCampaign(db, c.id, { maxResults: 25 });
      totalNew += summary.inserted;
      logger.info(
        { campaignId: c.id, name: c.name, summary },
        "auto-scout: scraped active campaign",
      );
    } catch (err) {
      logger.warn(
        { campaignId: c.id, err: String(err) },
        "auto-scout: scrape failed for campaign",
      );
    }
  }

  return { scrapedCampaigns: picks.length, totalNew };
}

export function startCron(db: DbClient): void {
  // Pipeline cycle every 3 minutes
  cron.schedule("*/3 * * * *", async () => {
    if (running.pipeline) return;
    running.pipeline = true;
    try {
      const counts = await runPipelineCycle(db);
      if (Object.values(counts).some((c) => c > 0)) logger.info({ counts }, "pipeline cycle");
      const sent = await runAutoSendPass(db);
      if (sent > 0) logger.info({ sent }, "auto-send pass");
    } catch (err) {
      logger.error({ err: String(err) }, "pipeline cycle failed");
    } finally {
      running.pipeline = false;
    }
  });

  // LinkedIn inbox polling every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    if (running.inbox) return;
    running.inbox = true;
    try {
      const result = await pollLinkedInInbox(db);
      if (result.acceptedCount || result.newMessages) logger.info(result, "linkedin inbox poll");
    } catch (err) {
      logger.error({ err: String(err) }, "inbox poll failed");
    } finally {
      running.inbox = false;
    }
  });

  // Daily auto-scout: re-runs Places scrape on active campaigns to drip in
  // new outdated-site leads. Runs at 09:00 UTC every day (~midnight LA, ~5pm
  // Bangkok) — far outside the pipeline's busy hours.
  cron.schedule("0 9 * * *", async () => {
    if (running.scout) return;
    running.scout = true;
    try {
      const result = await runDailyAutoScout(db);
      logger.info(result, "daily auto-scout completed");
    } catch (err) {
      logger.error({ err: String(err) }, "daily auto-scout failed");
    } finally {
      running.scout = false;
    }
  });

  logger.info("cron scheduler started");
}

// Exported so an admin endpoint can trigger it on demand.
export async function triggerAutoScoutNow(db: DbClient): Promise<{ scrapedCampaigns: number; totalNew: number } | { skipped: true }> {
  if (running.scout) return { skipped: true };
  running.scout = true;
  try {
    return await runDailyAutoScout(db);
  } finally {
    running.scout = false;
  }
}
