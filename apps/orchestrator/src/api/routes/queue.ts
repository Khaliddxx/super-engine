import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  desc,
  eq,
  and,
  type DbClient,
  triage,
  prospects,
  messages,
  threads,
  campaigns,
} from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import { sendChatMessage, startChat } from "../../integrations/unipile.js";
import { env } from "../../lib/env.js";
import { transition } from "../../modules/transitions.js";
import { sanitizeTopIssues } from "../../modules/qualify.js";
import { notify } from "../../integrations/slack.js";
import { logger } from "../../lib/logger.js";
import { redesignProspect } from "../../modules/redesign.js";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };

export async function queueRoutes(app: FastifyInstance, opts: Opts): Promise<void> {
  app.addHook("onRequest", requireAuth);

  // List pending triage cards + redesign-review cards (REDESIGNED prospects)
  app.get("/", async () => {
    const db = opts.db();
    const triageRows = await db
      .select({
        id: triage.id,
        status: triage.status,
        kind: triage.kind,
        classification: triage.classification,
        confidence: triage.confidence,
        summary: triage.summary,
        draftResponse: triage.draftResponse,
        editedResponse: triage.editedResponse,
        reasoning: triage.reasoning,
        priority: triage.priority,
        createdAt: triage.createdAt,
        messageId: triage.messageId,
        prospectId: triage.prospectId,
        businessName: prospects.businessName,
        niche: prospects.niche,
        city: prospects.city,
        redesignHtmlUrl: prospects.redesignHtmlUrl,
        linkedinUrl: prospects.linkedinUrl,
        email: prospects.email,
        contactFirstName: prospects.contactFirstName,
        contactLastName: prospects.contactLastName,
        contactTitle: prospects.contactTitle,
        outreachChannel: campaigns.outreachChannel,
      })
      .from(triage)
      .innerJoin(prospects, eq(prospects.id, triage.prospectId))
      .leftJoin(campaigns, eq(prospects.campaignId, campaigns.id))
      .where(eq(triage.status, "pending"))
      .orderBy(desc(triage.createdAt));

    triageRows.sort(
      (a, b) =>
        (priorityRank[a.priority ?? "low"] ?? 2) - (priorityRank[b.priority ?? "low"] ?? 2) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const items = triageRows.map((r) => ({ type: "triage" as const, ...r }));

    // Redesign-review cards: prospects in REDESIGNED state need a human eyeball
    // before they advance to APPROVED_TO_SEND. Surfacing them in the same queue
    // as triage keeps the operator loop in one place.
    const reviewRows = await db
      .select({
        id: prospects.id,
        businessName: prospects.businessName,
        niche: prospects.niche,
        city: prospects.city,
        website: prospects.website,
        screenshotUrl: prospects.screenshotUrl,
        redesignHtmlUrl: prospects.redesignHtmlUrl,
        linkedinUrl: prospects.linkedinUrl,
        email: prospects.email,
        contactFirstName: prospects.contactFirstName,
        contactLastName: prospects.contactLastName,
        contactTitle: prospects.contactTitle,
        qualificationIssues: prospects.qualificationIssues,
        qualificationScore: prospects.qualificationScore,
        qualificationReasoning: prospects.qualificationReasoning,
        scrapedAssets: prospects.scrapedAssets,
        variantPalette: prospects.variantPalette,
        variantLayout: prospects.variantLayout,
        redesignDeployedAt: prospects.redesignDeployedAt,
        updatedAt: prospects.updatedAt,
        outreachChannel: campaigns.outreachChannel,
      })
      .from(prospects)
      .leftJoin(campaigns, eq(prospects.campaignId, campaigns.id))
      .where(eq(prospects.state, "REDESIGNED"))
      .orderBy(desc(prospects.updatedAt))
      .limit(50);

    const reviewItems = reviewRows.map((r) => {
      const assets = (r.scrapedAssets as any) ?? null;
      const imageCount = Array.isArray(assets?.images) ? assets.images.length : 0;
      return {
        type: "review_redesign" as const,
        id: `review:${r.id}`,
        prospectId: r.id,
        status: "pending" as const,
        createdAt: r.redesignDeployedAt ?? r.updatedAt,
        businessName: r.businessName,
        niche: r.niche,
        city: r.city,
        website: r.website,
        screenshotUrl: r.screenshotUrl,
        redesignHtmlUrl: r.redesignHtmlUrl,
        linkedinUrl: r.linkedinUrl,
        qualificationIssues: sanitizeTopIssues(r.qualificationIssues),
        qualificationScore: r.qualificationScore,
        qualificationReasoning: r.qualificationReasoning,
        variantPalette: r.variantPalette,
        variantLayout: r.variantLayout,
        assetsSummary: { imageCount, hasLogo: !!assets?.logo, hasHero: !!(assets?.heroImage || assets?.heroVideo) },
        email: r.email,
        contactFirstName: r.contactFirstName,
        contactLastName: r.contactLastName,
        contactTitle: r.contactTitle,
        outreachChannel: r.outreachChannel ?? "both",
      };
    });

    const enrichedPendingRows = await db
      .select({
        id: prospects.id,
        businessName: prospects.businessName,
        niche: prospects.niche,
        city: prospects.city,
        website: prospects.website,
        screenshotUrl: prospects.screenshotUrl,
        linkedinUrl: prospects.linkedinUrl,
        email: prospects.email,
        contactFirstName: prospects.contactFirstName,
        contactLastName: prospects.contactLastName,
        contactTitle: prospects.contactTitle,
        qualificationIssues: prospects.qualificationIssues,
        qualificationScore: prospects.qualificationScore,
        qualificationReasoning: prospects.qualificationReasoning,
        scrapedAssets: prospects.scrapedAssets,
        updatedAt: prospects.updatedAt,
        outreachChannel: campaigns.outreachChannel,
      })
      .from(prospects)
      .innerJoin(campaigns, eq(campaigns.id, prospects.campaignId))
      .where(and(eq(prospects.state, "ENRICHED"), eq(campaigns.autoRedesignAfterEnrich, false)))
      .orderBy(desc(prospects.updatedAt))
      .limit(50);

    const enrichedReviewItems = enrichedPendingRows.map((r) => {
      const assets = (r.scrapedAssets as any) ?? null;
      const imageCount = Array.isArray(assets?.images) ? assets.images.length : 0;
      return {
        type: "review_enriched" as const,
        id: `enriched:${r.id}`,
        prospectId: r.id,
        status: "pending" as const,
        createdAt: r.updatedAt,
        businessName: r.businessName,
        niche: r.niche,
        city: r.city,
        website: r.website,
        screenshotUrl: r.screenshotUrl,
        linkedinUrl: r.linkedinUrl,
        qualificationIssues: sanitizeTopIssues(r.qualificationIssues),
        qualificationScore: r.qualificationScore,
        qualificationReasoning: r.qualificationReasoning,
        assetsSummary: { imageCount, hasLogo: !!assets?.logo, hasHero: !!(assets?.heroImage || assets?.heroVideo) },
        email: r.email,
        contactFirstName: r.contactFirstName,
        contactLastName: r.contactLastName,
        contactTitle: r.contactTitle,
        outreachChannel: r.outreachChannel ?? "both",
      };
    });

    return { items: [...enrichedReviewItems, ...reviewItems, ...items] };
  });

  // Start redesign for ENRICHED prospect (manual gate when auto_redesign_after_enrich is false)
  app.post<{ Params: { prospectId: string } }>("/enriched/:prospectId/start-redesign", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.prospectId));
    if (!p) return reply.status(404).send({ error: "not_found" });
    if (p.state !== "ENRICHED" && p.state !== "REDESIGN_FAILED") {
      return reply.status(400).send({ error: "not_enriched", state: p.state });
    }
    try {
      if (p.state === "REDESIGN_FAILED") {
        await transition({
          db,
          prospectId: p.id,
          from: "REDESIGN_FAILED",
          to: "ENRICHED",
          reason: "operator_retry_redesign",
          triggeredBy: "operator",
          patch: { rejectionReason: null },
        });
        const [fresh] = await db.select().from(prospects).where(eq(prospects.id, p.id));
        if (!fresh) return reply.status(404).send({ error: "not_found" });
        await redesignProspect(db, fresh);
      } else {
        await redesignProspect(db, p);
      }
    } catch (err) {
      logger.error({ err: String(err), prospectId: p.id }, "manual start-redesign failed");
      return reply.status(502).send({ error: "redesign_failed", detail: String(err) });
    }
    return { ok: true };
  });

  // Approve a redesign review card → APPROVED_TO_SEND
  app.post<{ Params: { prospectId: string } }>("/review/:prospectId/approve", async (req, reply) => {
    const db = opts.db();
    const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.prospectId));
    if (!p) return reply.status(404).send({ error: "not_found" });
    if (p.state !== "REDESIGNED") return reply.status(400).send({ error: "not_reviewable", state: p.state });
    await transition({
      db,
      prospectId: p.id,
      from: p.state as any,
      to: "APPROVED_TO_SEND",
      reason: "operator_review_approved",
      triggeredBy: "operator",
    });
    logger.info({ prospectId: p.id }, "redesign approved from queue");
    return { ok: true };
  });

  // Reject a redesign review card → REJECTED (operator_review_rejected)
  app.post<{ Params: { prospectId: string }; Body: { reason?: string } }>(
    "/review/:prospectId/reject",
    async (req, reply) => {
      const db = opts.db();
      const [p] = await db.select().from(prospects).where(eq(prospects.id, req.params.prospectId));
      if (!p) return reply.status(404).send({ error: "not_found" });
      if (p.state !== "REDESIGNED") return reply.status(400).send({ error: "not_reviewable", state: p.state });
      const reason = req.body?.reason ?? "operator_review_rejected";
      await transition({
        db,
        prospectId: p.id,
        from: p.state as any,
        to: "REJECTED",
        reason,
        triggeredBy: "operator",
        patch: { rejectionReason: reason },
      });
      return { ok: true };
    },
  );

  // Get a single triage card with full thread
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const db = opts.db();
    const [row] = await db.select().from(triage).where(eq(triage.id, req.params.id));
    if (!row) return reply.status(404).send({ error: "not_found" });
    const [prospect] = await db.select().from(prospects).where(eq(prospects.id, row.prospectId));
    const [thread] = await db
      .select()
      .from(threads)
      .where(eq(threads.prospectId, row.prospectId));
    const thread_messages = thread
      ? await db.select().from(messages).where(eq(messages.threadId, thread.id)).orderBy(messages.createdAt)
      : [];
    return { triage: row, prospect, thread, messages: thread_messages };
  });

  // Approve (optionally with edited text) → send
  app.post<{ Params: { id: string }; Body: { text?: string } }>("/:id/approve", async (req, reply) => {
    const db = opts.db();
    const [row] = await db.select().from(triage).where(eq(triage.id, req.params.id));
    if (!row) return reply.status(404).send({ error: "not_found" });
    if (row.status !== "pending") return reply.status(400).send({ error: "not_pending" });

    const [prospect] = await db.select().from(prospects).where(eq(prospects.id, row.prospectId));
    if (!prospect) return reply.status(404).send({ error: "prospect_not_found" });

    const finalText = (req.body?.text ?? row.draftResponse ?? "").trim();
    if (!finalText) return reply.status(400).send({ error: "empty_message" });

    const cfg = env();
    if (!cfg.UNIPILE_ACCOUNT_ID || !cfg.UNIPILE_DSN) return reply.status(500).send({ error: "unipile_not_configured" });

    const [thread] = await db.select().from(threads).where(eq(threads.prospectId, prospect.id));
    let chatId = thread?.externalThreadId ?? prospect.linkedinChatId;
    let externalMessageId = "";

    try {
      if (chatId) {
        const result = await sendChatMessage({ chatId, text: finalText });
        externalMessageId = result.messageId;
      } else {
        if (!prospect.linkedinProviderId) return reply.status(400).send({ error: "no_provider_id" });
        const result = await startChat({
          accountId: cfg.UNIPILE_ACCOUNT_ID,
          providerId: prospect.linkedinProviderId,
          text: finalText,
        });
        chatId = result.chatId;
        externalMessageId = result.messageId;
      }
    } catch (err) {
      return reply.status(502).send({ error: "send_failed", detail: String(err) });
    }

    const threadId =
      thread?.id ??
      (
        await db
          .insert(threads)
          .values({ prospectId: prospect.id, channel: "linkedin", externalThreadId: chatId })
          .returning()
      )[0]!.id;
    if (thread && !thread.externalThreadId && chatId) {
      await db.update(threads).set({ externalThreadId: chatId }).where(eq(threads.id, thread.id));
    }

    await db.insert(messages).values({
      threadId,
      direction: "out",
      channel: "linkedin",
      content: finalText,
      sentAt: new Date(),
      externalMessageId,
    });

    const edited = req.body?.text && req.body.text.trim() !== (row.draftResponse ?? "").trim();
    await db
      .update(triage)
      .set({
        status: edited ? "edited" : "approved",
        editedResponse: edited ? req.body!.text! : null,
        approvedAt: new Date(),
        sentAt: new Date(),
      })
      .where(eq(triage.id, row.id));

    // For reply triages, move to RESPONDED. For first-DM, keep in AWAITING since they haven't replied to the DM yet.
    if (row.kind === "first_dm_after_accept") {
      if (prospect.state !== "AWAITING") {
        await transition({
          db,
          prospectId: prospect.id,
          from: prospect.state as any,
          to: "AWAITING",
          reason: "first_dm_sent",
          triggeredBy: "operator",
          patch: { linkedinChatId: chatId ?? undefined },
        });
      } else if (chatId && !prospect.linkedinChatId) {
        await db.update(prospects).set({ linkedinChatId: chatId }).where(eq(prospects.id, prospect.id));
      }
    } else {
      await transition({
        db,
        prospectId: prospect.id,
        from: prospect.state as any,
        to: "RESPONDED",
        reason: "operator_replied",
        triggeredBy: "operator",
      });
    }

    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/:id/reject", async (req, reply) => {
    const db = opts.db();
    const [row] = await db.select().from(triage).where(eq(triage.id, req.params.id));
    if (!row) return reply.status(404).send({ error: "not_found" });
    await db
      .update(triage)
      .set({ status: "rejected", operatorNote: req.body?.reason ?? null })
      .where(eq(triage.id, row.id));
    return { ok: true };
  });

  app.post<{ Body: { count?: number } }>("/seed-demo", async (req) => {
    const db = opts.db();
    const n = Math.min(req.body?.count ?? 3, 5);
    const { seedDemoTriage } = await import("../../scripts/seed-demo.js");
    const created = await seedDemoTriage(db, n);
    await notify(`Seeded ${created} demo triage cards`).catch(() => {});
    return { created };
  });
}
