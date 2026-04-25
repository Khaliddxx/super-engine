import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { eq, desc, type DbClient, campaigns, prospects } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import { scrapeProspectsForCampaign } from "../../modules/scrape.js";
import { runPipelineCycle } from "../../modules/scheduler.js";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function campaignRoutes(app: FastifyInstance, opts: Opts): Promise<void> {
  app.addHook("onRequest", requireAuth);

  app.get("/", async () => {
    const db = opts.db();
    const rows = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt));
    return { items: rows };
  });

  app.post<{
    Body: {
      name: string;
      niche: string;
      targetCity?: string;
      targetCountry?: string;
      maxProspects?: number;
      outreachChannel?: string;
      imageryStrategy?: string;
    };
  }>("/", async (req, reply) => {
    const db = opts.db();
    const body = req.body ?? ({} as any);
    if (!body.name || !body.niche) return reply.status(400).send({ error: "missing_fields" });
    const [row] = await db
      .insert(campaigns)
      .values({
        name: body.name,
        niche: body.niche,
        targetCity: body.targetCity,
        targetCountry: (body.targetCountry ?? "AU").toUpperCase().slice(0, 2),
        maxProspects: body.maxProspects ?? 20,
        outreachChannel: body.outreachChannel ?? "linkedin",
        imageryStrategy: body.imageryStrategy ?? "none",
        autoSendEnabled: false,
      })
      .returning();
    return { campaign: row };
  });

  app.post<{ Params: { id: string }; Body: { maxResults?: number } }>("/:id/scan", async (req) => {
    const db = opts.db();
    const summary = await scrapeProspectsForCampaign(db, req.params.id, { maxResults: req.body?.maxResults });
    return { summary };
  });

  app.post<{ Params: { id: string } }>("/:id/run-cycle", async () => {
    const db = opts.db();
    const counts = await runPipelineCycle(db);
    return { counts };
  });

  app.post<{ Params: { id: string }; Body: { status: "active" | "paused" | "complete" } }>(
    "/:id/status",
    async (req, reply) => {
      const db = opts.db();
      if (!["active", "paused", "complete"].includes(req.body?.status)) {
        return reply.status(400).send({ error: "invalid_status" });
      }
      await db.update(campaigns).set({ status: req.body.status }).where(eq(campaigns.id, req.params.id));
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>("/:id/prospects", async (req) => {
    const db = opts.db();
    const rows = await db
      .select()
      .from(prospects)
      .where(eq(prospects.campaignId, req.params.id))
      .orderBy(desc(prospects.updatedAt));
    return { items: rows };
  });
}
