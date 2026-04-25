import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { desc, eq, type DbClient, prospects, campaigns, deployments } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import { transition } from "../../modules/transitions.js";
import { redesignProspect } from "../../modules/redesign.js";
import { sendLinkedInInviteForProspect, draftInviteNote } from "../../modules/send.js";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function pipelineRoutes(app: FastifyInstance, opts: Opts): Promise<void> {
  app.addHook("onRequest", requireAuth);

  app.get("/", async (req) => {
    const db = opts.db();
    const query = req.query as { state?: string; campaign?: string };
    const rows = await db
      .select({
        id: prospects.id,
        state: prospects.state,
        businessName: prospects.businessName,
        niche: prospects.niche,
        city: prospects.city,
        website: prospects.website,
        redesignHtmlUrl: prospects.redesignHtmlUrl,
        rejectionReason: prospects.rejectionReason,
        qualificationScore: prospects.qualificationScore,
        qualificationReasoning: prospects.qualificationReasoning,
        qualificationIssues: prospects.qualificationIssues,
        variantPalette: prospects.variantPalette,
        variantFonts: prospects.variantFonts,
        variantLayout: prospects.variantLayout,
        linkedinUrl: prospects.linkedinUrl,
        email: prospects.email,
        screenshotUrl: prospects.screenshotUrl,
        campaignId: prospects.campaignId,
        createdAt: prospects.createdAt,
        updatedAt: prospects.updatedAt,
      })
      .from(prospects)
      .where(query.state ? eq(prospects.state, query.state) : undefined as any)
      .orderBy(desc(prospects.updatedAt))
      .limit(200);
    return { items: rows };
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
    if (!p) return reply.status(404).send({ error: "not_found" });
    const [c] = p.campaignId
      ? await db.select().from(campaigns).where(eq(campaigns.id, p.campaignId))
      : [null];
    const depHistory = await db
      .select()
      .from(deployments)
      .where(eq(deployments.prospectId, p.id))
      .orderBy(desc(deployments.createdAt));
    return { prospect: p, campaign: c, deployments: depHistory };
  });

  // Draft an invite note (Claude), return the message — operator can edit before sending
  app.post<{ Params: { id: string } }>("/:id/draft-invite", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
    if (!p) return reply.status(404).send({ error: "not_found" });
    if (!p.linkedinUrl) return reply.status(400).send({ error: "no_linkedin_url" });
    if (!p.redesignHtmlUrl) return reply.status(400).send({ error: "no_redesign" });
    const body = await draftInviteNote(p);
    return { body };
  });

  // Approve a redesign — moves to APPROVED_TO_SEND and (if provided) schedules/sends an invite
  app.post<{ Params: { id: string }; Body: { approvedMessage?: string; sendNow?: boolean } }>(
    "/:id/approve",
    async (req, reply) => {
      const db = opts.db();
      const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
      if (!p) return reply.status(404).send({ error: "not_found" });
      if (p.state !== "REDESIGNED" && p.state !== "APPROVED_TO_SEND") {
        return reply.status(400).send({ error: "not_in_reviewable_state", state: p.state });
      }

      if (p.state === "REDESIGNED") {
        await transition({
          db,
          prospectId: p.id,
          from: p.state,
          to: "APPROVED_TO_SEND",
          reason: "operator_approved_redesign",
          triggeredBy: "operator",
        });
      }

      if (req.body?.sendNow) {
        const [refreshed] = await db.select().from(prospects).where(eq(prospects.id, p.id));
        if (!refreshed) return reply.status(404).send({ error: "not_found_after_transition" });
        const result = await sendLinkedInInviteForProspect(db, refreshed, {
          approvedMessage: req.body.approvedMessage,
        });
        return { ok: true, send: result };
      }

      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/:id/reject", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
    if (!p) return reply.status(404).send({ error: "not_found" });
    await transition({
      db,
      prospectId: p.id,
      from: p.state as any,
      to: "REJECTED",
      reason: req.body?.reason ?? "operator_rejected",
      triggeredBy: "operator",
      patch: { rejectionReason: req.body?.reason ?? "operator_rejected" },
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/:id/regenerate", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
    if (!p) return reply.status(404).send({ error: "not_found" });
    if (!["QUALIFIED", "REDESIGNED"].includes(p.state)) {
      return reply.status(400).send({ error: "wrong_state", state: p.state });
    }
    // Revert to QUALIFIED so the scheduler (or this immediate call) regenerates
    if (p.state !== "QUALIFIED") {
      await transition({
        db,
        prospectId: p.id,
        from: p.state as any,
        to: "QUALIFIED",
        reason: "regenerate_requested",
        triggeredBy: "operator",
      });
    }
    const [refreshed] = await db.select().from(prospects).where(eq(prospects.id, p.id));
    if (!refreshed) return reply.status(404).send({ error: "not_found_after_transition" });
    await redesignProspect(db, refreshed);
    return { ok: true };
  });
}
