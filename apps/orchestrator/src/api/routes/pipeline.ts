import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { and, desc, eq, gte, lte, type DbClient, prospects, campaigns, deployments } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import { transition } from "../../modules/transitions.js";
import { redesignProspect } from "../../modules/redesign.js";
import { enrichProspect } from "../../modules/enrich.js";
import {
  sendApprovedOutreachForProspect,
  draftInviteNote,
  draftInitialEmail,
  sendEmailInitialForProspect,
} from "../../modules/send.js";
import { sanitizeTopIssues } from "../../modules/qualify.js";
import { env } from "../../lib/env.js";
import { patchRedesignNavbar } from "../../modules/redesign-patch.js";
import { logger } from "../../lib/logger.js";

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
        contactFirstName: prospects.contactFirstName,
        contactLastName: prospects.contactLastName,
        contactTitle: prospects.contactTitle,
        screenshotUrl: prospects.screenshotUrl,
        campaignId: prospects.campaignId,
        createdAt: prospects.createdAt,
        updatedAt: prospects.updatedAt,
      })
      .from(prospects)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(prospects.updatedAt))
      .limit(200);
    const items = rows.map((r) => ({
      ...r,
      qualificationIssues: sanitizeTopIssues(r.qualificationIssues),
    }));
    return { items, since: since?.toISOString() ?? null };
  });

  // Operational diagnostics: find prospects that have not moved for N minutes.
  app.get<{ Querystring: { state?: string; olderThanMin?: string; limit?: string } }>("/stuck", async (req) => {
    const db = opts.db();
    const state = (req.query.state ?? "ENRICHED").toUpperCase();
    const olderThanMin = Math.max(5, Number(req.query.olderThanMin ?? 60) || 60);
    const limit = Math.min(200, Number(req.query.limit ?? 50) || 50);
    const cutoff = new Date(Date.now() - olderThanMin * 60 * 1000);
    const rows = await db
      .select({
        id: prospects.id,
        state: prospects.state,
        businessName: prospects.businessName,
        niche: prospects.niche,
        city: prospects.city,
        campaignId: prospects.campaignId,
        rejectionReason: prospects.rejectionReason,
        updatedAt: prospects.updatedAt,
        createdAt: prospects.createdAt,
      })
      .from(prospects)
      .where(and(eq(prospects.state, state as any), lte(prospects.updatedAt, cutoff)))
      .orderBy(desc(prospects.updatedAt))
      .limit(limit);
    return { state, olderThanMin, count: rows.length, items: rows };
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
    const cleaned = {
      ...p,
      qualificationIssues: sanitizeTopIssues(p.qualificationIssues as string[] | null | undefined),
    };
    const cfg = env();
    const booking = (cfg.STUDIO_BOOKING_URL ?? "").trim();
    const studioBookingUrl =
      booking && /^https?:\/\//i.test(booking) ? booking : null;
    const opEmail = (cfg.OPERATOR_EMAIL ?? "").trim();
    const studioBookingMailto =
      opEmail && opEmail.includes("@") ? `mailto:${opEmail}?subject=Book%20a%2015-min%20call` : null;
    return {
      prospect: cleaned,
      campaign: c,
      deployments: depHistory,
      studioBookingUrl,
      studioBookingMailto,
    };
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

  app.post<{ Params: { id: string } }>("/:id/draft-email", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
    if (!p) return reply.status(404).send({ error: "not_found" });
    if (!p.email) return reply.status(400).send({ error: "no_email" });
    if (!p.redesignHtmlUrl && !p.website) return reply.status(400).send({ error: "no_link_for_email_context" });
    return await draftInitialEmail(p);
  });

  app.post<{
    Params: { id: string };
    Body: { subject?: string; body?: string };
  }>("/:id/send-email-now", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
    if (!p) return reply.status(404).send({ error: "not_found" });
    if (!p.campaignId) return reply.status(400).send({ error: "no_campaign" });
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, p.campaignId));
    const channel = c?.outreachChannel ?? "both";
    if (channel !== "email" && channel !== "both") {
      return reply.status(400).send({ error: "email_channel_disabled", outreachChannel: channel });
    }
    if (!["ENRICHED", "REDESIGNED", "APPROVED_TO_SEND"].includes(p.state)) {
      return reply.status(400).send({ error: "wrong_state", state: p.state });
    }
    if (!p.email) return reply.status(400).send({ error: "no_email" });
    const result = await sendEmailInitialForProspect(db, p, {
      approvedSubject: req.body?.subject,
      approvedBody: req.body?.body,
    });
    return { ok: result.sent, send: result };
  });

  // Approve a redesign — moves to APPROVED_TO_SEND and (if provided) schedules/sends an invite
  app.post<{
    Params: { id: string };
    Body: { approvedMessage?: string; approvedEmailSubject?: string; approvedEmailBody?: string; sendNow?: boolean };
  }>(
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
        const result = await sendApprovedOutreachForProspect(db, refreshed, {
          approvedMessage: req.body.approvedMessage,
          approvedEmailSubject: req.body.approvedEmailSubject,
          approvedEmailBody: req.body.approvedEmailBody,
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

  // Retry enrich without forcing a full NEW reset.
  app.post<{ Params: { id: string } }>("/:id/retry-enrich", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
    if (!p) return reply.status(404).send({ error: "not_found" });
    if (p.state !== "QUALIFIED") {
      return reply.status(400).send({ error: "wrong_state", expected: "QUALIFIED", state: p.state });
    }
    try {
      await enrichProspect(db, p);
      return { ok: true };
    } catch (err) {
      return reply.status(502).send({ error: "enrich_failed", detail: String(err) });
    }
  });

  // Retry redesign for prospects already enriched.
  app.post<{ Params: { id: string } }>("/:id/retry-redesign", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
    if (!p) return reply.status(404).send({ error: "not_found" });
    if (p.state !== "ENRICHED") {
      return reply.status(400).send({ error: "wrong_state", expected: "ENRICHED", state: p.state });
    }
    try {
      await redesignProspect(db, p);
      return { ok: true };
    } catch (err) {
      return reply.status(502).send({ error: "redesign_failed", detail: String(err) });
    }
  });

  app.post<{
    Params: { id: string };
    Body: { scope?: string; instruction?: string };
  }>("/:id/redesign-html-patch", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
    if (!p) return reply.status(404).send({ error: "not_found" });
    if (!p.redesignHtmlUrl) return reply.status(400).send({ error: "no_redesign" });
    const scope = req.body?.scope ?? "navbar";
    if (scope !== "navbar") return reply.status(400).send({ error: "unsupported_scope" });
    const instruction = req.body?.instruction?.trim() ?? "";
    if (!instruction) return reply.status(400).send({ error: "instruction_required" });
    try {
      const result = await patchRedesignNavbar(db, p, { scope: "navbar", instruction });
      return { ok: true, url: result.url, warnings: result.warnings };
    } catch (err) {
      const msg = String(err);
      if (msg.includes("instruction_required")) {
        return reply.status(400).send({ error: "instruction_required" });
      }
      if (
        msg.includes("no_redesign_url") ||
        msg.includes("no_deployment") ||
        msg.includes("index_html_missing") ||
        msg.includes("missing_page:")
      ) {
        return reply.status(400).send({ error: "patch_precondition", detail: msg });
      }
      if (msg.includes("unsupported_scope")) {
        return reply.status(400).send({ error: "unsupported_scope" });
      }
      logger.error({ err: msg, prospectId: p.id }, "redesign-html-patch failed");
      return reply.status(502).send({ error: "patch_failed", detail: msg });
    }
  });

  app.post<{ Params: { id: string }; Body: { instruction?: string | null } }>(
    "/:id/regenerate",
    async (req, reply) => {
      const db = opts.db();
      const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
      if (!p) return reply.status(404).send({ error: "not_found" });
      if (!["QUALIFIED", "ENRICHED", "REDESIGNED"].includes(p.state)) {
        return reply.status(400).send({ error: "wrong_state", state: p.state });
      }

      // Save the operator instruction (or clear it if explicitly null/empty).
      // Persisting BEFORE the transition means the next redesignProspect call
      // sees it on the refreshed row.
      if (req.body && "instruction" in req.body) {
        const next = req.body.instruction?.trim() || null;
        await db.update(prospects).set({ redesignInstruction: next, updatedAt: new Date() }).where(eq(prospects.id, p.id));
      }

      if (p.state === "REDESIGNED") {
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
      if (refreshed.state === "QUALIFIED") {
        await redesignProspect(db, refreshed);
      } else if (refreshed.state === "ENRICHED") {
        await redesignProspect(db, refreshed);
      } else {
        return reply.status(400).send({ error: "wrong_state_after_refresh", state: refreshed.state });
      }
      return { ok: true, instruction: refreshed.redesignInstruction ?? null };
    },
  );

  /**
   * Save (or clear) the operator's free-text design instruction WITHOUT
   * triggering a regenerate. Useful when iterating on the prompt before
   * burning Claude credits. Pass `instruction: null` (or empty string) to clear.
   */
  app.post<{ Params: { id: string }; Body: { instruction?: string | null } }>(
    "/:id/instruction",
    async (req, reply) => {
      const db = opts.db();
      const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
      if (!p) return reply.status(404).send({ error: "not_found" });
      const next = req.body?.instruction?.trim() || null;
      await db
        .update(prospects)
        .set({ redesignInstruction: next, updatedAt: new Date() })
        .where(eq(prospects.id, p.id));
      return { ok: true, instruction: next };
    },
  );

  /**
   * Full regenerate: re-ENRICH (to backfill scrapedAssets with logo/hero
   * images/brand colors/fonts) and then re-REDESIGN with the current V2
   * prompt. Use this on prospects redesigned before asset extraction shipped.
   * Safe to call on REDESIGNED, APPROVED_TO_SEND, or REJECTED prospects.
   */
  app.post<{ Params: { id: string } }>("/:id/regenerate-full", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.id));
    if (!p) return reply.status(404).send({ error: "not_found" });

    // Put the prospect into QUALIFIED so enrichProspect's transition to ENRICHED is valid,
    // and to signal to anyone watching the pipeline that a full regenerate is in progress.
    await transition({
      db,
      prospectId: p.id,
      from: p.state as any,
      to: "QUALIFIED",
      reason: "regenerate_full_requested",
      triggeredBy: "operator",
      patch: { rejectionReason: null },
    });

    const [q] = await db.select().from(prospects).where(eq(prospects.id, p.id));
    if (!q) return reply.status(404).send({ error: "not_found_after_transition" });

    try {
      await enrichProspect(db, q);
    } catch (err) {
      return reply.status(502).send({ error: "enrich_failed", detail: String(err) });
    }

    const [r] = await db.select().from(prospects).where(eq(prospects.id, p.id));
    if (!r) return reply.status(404).send({ error: "not_found_after_enrich" });
    if (r.state !== "ENRICHED") {
      // enrichProspect transitioned to REJECTED (e.g. no_contact / domain_parked) — surface it.
      return reply.status(422).send({
        error: "enrich_rejected",
        state: r.state,
        rejectionReason: r.rejectionReason,
      });
    }

    try {
      await redesignProspect(db, r);
    } catch (err) {
      return reply.status(502).send({ error: "redesign_failed", detail: String(err) });
    }
    return { ok: true };
  });
}
