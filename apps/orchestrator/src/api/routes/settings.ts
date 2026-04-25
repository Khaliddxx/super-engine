import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { eq, type DbClient, operatorSettings } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import { env } from "../../lib/env.js";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function settingsRoutes(app: FastifyInstance, opts: Opts): Promise<void> {
  app.addHook("onRequest", requireAuth);

  app.get("/", async () => {
    const cfg = env();
    const db = opts.db();
    const [s] = await db
      .select()
      .from(operatorSettings)
      .where(eq(operatorSettings.operatorEmail, cfg.OPERATOR_EMAIL || "operator@local"));
    const linkedinDailyCap = s?.linkedinDailyCap ?? cfg.LINKEDIN_DAILY_CAP;
    return {
      operator: {
        name: cfg.OPERATOR_NAME,
        email: cfg.OPERATOR_EMAIL,
        phone: cfg.OPERATOR_PHONE,
      },
      linkedinDailyCap,
      claudeModel: cfg.CLAUDE_MODEL,
      unipileConfigured: Boolean(cfg.UNIPILE_ACCOUNT_ID && cfg.UNIPILE_API_KEY && cfg.UNIPILE_DSN),
      slackConfigured: Boolean(cfg.SLACK_WEBHOOK_URL),
    };
  });

  app.post<{ Body: { linkedinDailyCap?: number } }>("/", async (req) => {
    const cfg = env();
    const db = opts.db();
    const key = cfg.OPERATOR_EMAIL || "operator@local";
    const [existing] = await db.select().from(operatorSettings).where(eq(operatorSettings.operatorEmail, key));
    const cap = req.body?.linkedinDailyCap;
    if (existing) {
      await db
        .update(operatorSettings)
        .set({ linkedinDailyCap: cap ?? existing.linkedinDailyCap })
        .where(eq(operatorSettings.id, existing.id));
    } else {
      await db.insert(operatorSettings).values({
        operatorEmail: key,
        linkedinDailyCap: cap ?? cfg.LINKEDIN_DAILY_CAP,
      });
    }
    return { ok: true };
  });
}
