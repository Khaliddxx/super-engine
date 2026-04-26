import { asc, eq, type DbClient, prospects, campaigns, type Prospect } from "@super-engine/db";
import { enrichProspect } from "./enrich.js";
import { qualifyProspect } from "./qualify.js";
import { redesignProspect } from "./redesign.js";
import { sendApprovedOutreachForProspect } from "./send.js";
import { logger } from "../lib/logger.js";

async function listByState(db: DbClient, state: string, limit = 10): Promise<Prospect[]> {
  return db
    .select()
    .from(prospects)
    .where(eq(prospects.state, state))
    .orderBy(asc(prospects.updatedAt))
    .limit(limit);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Advance one batch of prospects through all automatic pipeline stages.
 * Stops short of APPROVED_TO_SEND (which requires operator approval).
 * Returns counts per stage processed.
 */
export async function runPipelineCycle(db: DbClient): Promise<Record<string, number>> {
  let qualified = 0;
  let enriched = 0;
  let redesigned = 0;

  // 1. QUALIFY FIRST (cheap: microlink screenshot + one Claude vision call)
  // This is the gatekeeper — reject chains, parked sites, and already-good sites
  // BEFORE we pay Firecrawl + Hunter credits on them.
  for (const p of await listByState(db, "NEW", 5)) {
    try {
      await withTimeout(qualifyProspect(db, p), 90_000, "qualify");
      qualified++;
    } catch (err) {
      logger.error({ err: String(err), prospectId: p.id }, "qualify failed");
    }
  }

  // 2. ENRICH the ones that passed qualify (multi-page scrape + assets + Hunter)
  for (const p of await listByState(db, "QUALIFIED", 5)) {
    try {
      await withTimeout(enrichProspect(db, p), 180_000, "enrich");
      enriched++;
    } catch (err) {
      logger.error({ err: String(err), prospectId: p.id }, "enrich failed");
    }
  }

  // 3. REDESIGN using the real assets we just extracted
  for (const p of await listByState(db, "ENRICHED", 3)) {
    try {
      await withTimeout(redesignProspect(db, p), 240_000, "redesign");
      redesigned++;
    } catch (err) {
      logger.error({ err: String(err), prospectId: p.id }, "redesign failed");
    }
  }

  return { qualified, enriched, redesigned };
}

/**
 * Optional auto-send pass: if a campaign has auto_send_enabled, send invites
 * for prospects in APPROVED_TO_SEND. Otherwise this is a no-op and the operator
 * drives sends via the PWA.
 */
export async function runAutoSendPass(db: DbClient): Promise<number> {
  const toSend = await db
    .select()
    .from(prospects)
    .innerJoin(campaigns, eq(campaigns.id, prospects.campaignId))
    .where(eq(prospects.state, "APPROVED_TO_SEND"))
    .orderBy(asc(prospects.updatedAt))
    .limit(25);
  let sent = 0;
  for (const row of toSend) {
    if (!row.campaigns.autoSendEnabled) continue;
    const p = row.prospects;
    try {
      const r = await sendApprovedOutreachForProspect(db, p);
      if (r.sent) sent++;
    } catch (err) {
      logger.error({ err: String(err), prospectId: p.id }, "auto-send failed");
    }
  }
  return sent;
}
