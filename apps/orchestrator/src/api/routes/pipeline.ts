import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { and, desc, eq, gte, type DbClient, prospects, campaigns, deployments } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import { transition } from "../../modules/transitions.js";
import { redesignProspect } from "../../modules/redesign.js";
import { sendLinkedInInviteForProspect, draftInviteNote } from "../../modules/send.js";

/** Translate a `since` token like "today" | "7d" | "30d" | "all" into a Date threshold. */
function resolveSince(token: string | undefined): Date | null {
  const t = (token ?? "30d").toLowerCase();
  if (t === "all") return null;
  if (t === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const m = /^(\d+)d$/.exec(t);
  if (m) return new Date(Date.now() - Number(m[1]) * 24 * 60 * 60 * 1000);
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function pipelineRoutes(app: FastifyInstance, opts: Opts): Promise<void> {
  app.addHook("onRequest", requireAuth);

  app.get("/", async (req) => {
    const db = opts.db();
    const query = req.query as { state?: string; campaign?: string; since?: string; campaignId?: string };
    const since = resolveSince(query.since);

    const filters: any[] = [];
    if (query.state) filters.push(eq(prospects.state, query.state));
    if (query.campaignId) filters.push(eq(prospects.campaignId, query.campaignId));
    if (since) filters.push(gte(prospects.updatedAt, since));

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
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(prospects.updatedAt))
      .limit(200);
    return { items: rows, since: since?.toISOString() ?? null };
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

  /**
   * Bulk-retry every REJECTED prospect whose rejection matches the given
   * reason(s). Useful after fixing Hunter / Firecrawl / etc — lets the
   * operator reset e.g. all `no_contact` rejects in one tap.
   */
  app.post<{ Body: { reasons?: string[]; campaignId?: string; since?: string } }>(
    "/retry-bulk",
    async (req) => {
      const db = opts.db();
      const since = resolveSince(req.body?.since);
      const reasons = req.body?.reasons?.length ? req.body.reasons : undefined;

      const filters: any[] = [eq(prospects.state, "REJECTED")];
      if (req.body?.campaignId) filters.push(eq(prospects.campaignId, req.body.campaignId));
      if (since) filters.push(gte(prospects.updatedAt, since));

      const rows = await db
        .select({ id: prospects.id, state: prospects.state, rejectionReason: prospects.rejectionReason })
        .from(prospects)
        .where(and(...filters));

      const targets = reasons
        ? rows.filter((r) => r.rejectionReason && reasons.includes(r.rejectionReason))
        : rows;

      let reset = 0;
      for (const r of targets) {
        await transition({
          db,
          prospectId: r.id,
          from: r.state as any,
          to: "NEW",
          reason: "operator_retry_bulk",
          triggeredBy: "operator",
          patch: { rejectionReason: null },
        });
        reset++;
      }
      return { reset, considered: rows.length };
    },
  );

  /**
   * Retry a REJECTED prospect — reset it to NEW so the next run-cycle picks
   * it up again. Useful after fixing an integration (e.g. Hunter key) or
   * when a scrape was transiently down.
   */
  app.post<{ Params: { id: string } }>("/:id/retry", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
    if (!p) return reply.status(404).send({ error: "not_found" });
    if (p.state !== "REJECTED") {
      return reply.status(400).send({ error: "not_rejected", state: p.state });
    }
    await transition({
      db,
      prospectId: p.id,
      from: p.state as any,
      to: "NEW",
      reason: "operator_retry",
      triggeredBy: "operator",
      patch: { rejectionReason: null },
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
