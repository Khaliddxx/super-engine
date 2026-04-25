import { eq, prospects, stateTransitions, type DbClient, type ProspectState } from "@super-engine/db";
import { logger } from "../lib/logger.js";

export interface TransitionArgs {
  db: DbClient;
  prospectId: string;
  from: ProspectState | null;
  to: ProspectState;
  reason?: string;
  triggeredBy?: string;
  triggeredById?: string;
  metadata?: Record<string, unknown>;
  patch?: Partial<typeof prospects.$inferInsert>;
}

/** Transition a prospect state atomically. Writes an audit row. */
export async function transition(args: TransitionArgs): Promise<void> {
  const now = new Date();
  await args.db.transaction(async (tx) => {
    const updateSet: Record<string, unknown> = {
      state: args.to,
      updatedAt: now,
      ...(args.patch ?? {}),
    };
    if (args.to === "SENT") updateSet.firstSentAt = now;
    if (["SENT", "AWAITING", "RESPONDED", "FOLLOWUP_1", "FOLLOWUP_2"].includes(args.to)) {
      updateSet.lastTouchedAt = now;
    }
    await tx.update(prospects).set(updateSet).where(eq(prospects.id, args.prospectId));
    await tx.insert(stateTransitions).values({
      prospectId: args.prospectId,
      fromState: args.from ?? undefined,
      toState: args.to,
      reason: args.reason,
      triggeredBy: args.triggeredBy ?? "scheduler",
      triggeredById: args.triggeredById,
      metadata: args.metadata ?? null,
    });
  });
  logger.info(
    { prospectId: args.prospectId, from: args.from, to: args.to, reason: args.reason },
    "state transition",
  );
}
