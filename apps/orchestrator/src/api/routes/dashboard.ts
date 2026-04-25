import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { and, eq, gte, count, type DbClient, prospects, sendLog, triage } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function dashboardRoutes(app: FastifyInstance, opts: Opts): Promise<void> {
  app.addHook("onRequest", requireAuth);

  app.get("/", async () => {
    const db = opts.db();
    const allStates = [
      "NEW",
      "ENRICHED",
      "QUALIFIED",
      "REJECTED",
      "REDESIGNED",
      "APPROVED_TO_SEND",
      "SENT",
      "AWAITING",
      "RESPONDED",
      "BOOKED",
      "WON",
      "LOST",
    ];

    const stateCounts: Record<string, number> = {};
    for (const s of allStates) {
      const [row] = await db.select({ c: count() }).from(prospects).where(eq(prospects.state, s));
      stateCounts[s] = Number(row?.c ?? 0);
    }

    // Today's sends
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [inviteToday] = await db
      .select({ c: count() })
      .from(sendLog)
      .where(and(eq(sendLog.kind, "invite"), eq(sendLog.status, "sent"), gte(sendLog.sentAt, startOfDay)));
    const [dmToday] = await db
      .select({ c: count() })
      .from(sendLog)
      .where(and(eq(sendLog.kind, "dm"), eq(sendLog.status, "sent"), gte(sendLog.sentAt, startOfDay)));

    const [pendingTriage] = await db
      .select({ c: count() })
      .from(triage)
      .where(eq(triage.status, "pending"));

    return {
      stateCounts,
      today: {
        invitesSent: Number(inviteToday?.c ?? 0),
        dmsSent: Number(dmToday?.c ?? 0),
      },
      pendingTriage: Number(pendingTriage?.c ?? 0),
    };
  });
}
