import { eq, and, type DbClient, prospects, type Prospect } from "@super-engine/db";
import { enrichProspect } from "./enrich.js";
import { qualifyProspect } from "./qualify.js";
import { redesignProspect } from "./redesign.js";
import { sendLinkedInInviteForProspect } from "./send.js";
import { logger } from "../lib/logger.js";

async function listByState(db: DbClient, state: string, limit = 10): Promise<Prospect[]> {
  return db.select().from(prospects).where(eq(prospects.state, state)).limit(limit);
}

/**
 * Advance one batch of prospects through all automatic pipeline stages.
 * Stops short of APPROVED_TO_SEND (which requires operator approval).
 * Returns counts per stage processed.
 */
export async function runPipelineCycle(db: DbClient): Promise<Record<string, number>> {
  let enriched = 0;
  let qualified = 0;
  let redesigned = 0;

  for (const p of await listByState(db, "NEW", 5)) {
    try {
      await enrichProspect(db, p);
      enriched++;
    } catch (err) {
      logger.error({ err: String(err), prospectId: p.id }, "enrich failed");
    }
  }

  for (const p of await listByState(db, "ENRICHED", 5)) {
    try {
      await qualifyProspect(db, p);
      qualified++;
    } catch (err) {
      logger.error({ err: String(err), prospectId: p.id }, "qualify failed");
    }
  }

  for (const p of await listByState(db, "QUALIFIED", 3)) {
    try {
      await redesignProspect(db, p);
      redesigned++;
    } catch (err) {
      logger.error({ err: String(err), prospectId: p.id }, "redesign failed");
    }
  }

  return { enriched, qualified, redesigned };
}

/**
 * Optional auto-send pass: if a campaign has auto_send_enabled, send invites
 * for prospects in APPROVED_TO_SEND. Otherwise this is a no-op and the operator
 * drives sends via the PWA.
 */
export async function runAutoSendPass(db: DbClient): Promise<number> {
  const toSend = await listByState(db, "APPROVED_TO_SEND", 10);
  let sent = 0;
  for (const p of toSend) {
    try {
      const r = await sendLinkedInInviteForProspect(db, p);
      if (r.sent) sent++;
    } catch (err) {
      logger.error({ err: String(err), prospectId: p.id }, "auto-send failed");
    }
  }
  return sent;
}
