import {
  and,
  eq,
  isNotNull,
  type DbClient,
  prospects,
  threads,
  messages,
  triage,
} from "@super-engine/db";
import { listChats, listMessages, listSentInvitations } from "../integrations/unipile.js";
import { env } from "../lib/env.js";
import { transition } from "./transitions.js";
import { draftFirstDm } from "./send.js";
import { triageMessage } from "./triage.js";
import { logger } from "../lib/logger.js";

/**
 * Poll Unipile for:
 *  1. Accepted connection invitations → draft first DM → create triage row kind='first_dm_after_accept'
 *  2. New inbound messages on existing LI chats → record message, triage
 */
export async function pollLinkedInInbox(db: DbClient): Promise<{ acceptedCount: number; newMessages: number }> {
  const cfg = env();
  if (!cfg.UNIPILE_ACCOUNT_ID || !cfg.UNIPILE_API_KEY || !cfg.UNIPILE_DSN) {
    logger.debug("unipile not configured, skipping inbox poll");
    return { acceptedCount: 0, newMessages: 0 };
  }

  let acceptedCount = 0;
  let newMessages = 0;

  // 1. Check for accepted invitations
  const sentInvitationProspects = await db
    .select()
    .from(prospects)
    .where(
      and(
        isNotNull(prospects.linkedinInvitationId),
        eq(prospects.state, "SENT"),
      ),
    );

  if (sentInvitationProspects.length) {
    let invitations: Awaited<ReturnType<typeof listSentInvitations>> = [];
    try {
      invitations = await listSentInvitations(cfg.UNIPILE_ACCOUNT_ID);
    } catch (err) {
      logger.warn({ err: String(err) }, "listSentInvitations failed — skipping invite accept check this cycle");
    }
    const invByExtId = new Map(invitations.map((i) => [i.invitationId, i]));

    for (const p of sentInvitationProspects) {
      const inv = p.linkedinInvitationId ? invByExtId.get(p.linkedinInvitationId) : null;
      if (inv && inv.status === "accepted") {
        acceptedCount++;
        await handleInvitationAccepted(db, p.id);
      }
    }

    // Fallback: if Unipile listSentInvitations returned nothing but chats show acceptance,
    // any chat where attendee matches a prospect's provider_id can be treated as accepted.
    if (!invitations.length) {
      try {
        const chats = await listChats(cfg.UNIPILE_ACCOUNT_ID);
        const providerIdToChat = new Map(chats.filter((c) => c.providerId).map((c) => [c.providerId!, c]));
        for (const p of sentInvitationProspects) {
          if (p.linkedinProviderId && providerIdToChat.has(p.linkedinProviderId) && !p.linkedinInvitationAcceptedAt) {
            acceptedCount++;
            await handleInvitationAccepted(db, p.id);
          }
        }
      } catch (err) {
        logger.warn({ err: String(err) }, "fallback listChats failed");
      }
    }
  }

  // 2. Poll chats for new inbound messages on awaiting/responded threads
  const activeThreads = await db
    .select()
    .from(threads)
    .where(eq(threads.channel, "linkedin"));

  if (!activeThreads.length) return { acceptedCount, newMessages };

  for (const thread of activeThreads) {
    if (!thread.externalThreadId) continue;
    const sinceIso = thread.lastCheckedAt?.toISOString();
    let msgs: Awaited<ReturnType<typeof listMessages>> = [];
    try {
      msgs = await listMessages(thread.externalThreadId, sinceIso);
    } catch (err) {
      logger.warn({ err: String(err), threadId: thread.id }, "listMessages failed");
      continue;
    }

    const inbound = msgs.filter((m) => m.direction === "in");
    for (const m of inbound) {
      // Dedupe by external_message_id
      const [existing] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.channel, "linkedin"), eq(messages.externalMessageId, m.id)))
        .limit(1);
      if (existing) continue;

      const [inserted] = await db
        .insert(messages)
        .values({
          threadId: thread.id,
          direction: "in",
          channel: "linkedin",
          content: m.text,
          receivedAt: new Date(m.sentAt),
          externalMessageId: m.id,
        })
        .returning();
      if (!inserted) continue;

      newMessages++;
      await triageMessage(db, inserted.id).catch((err) =>
        logger.error({ err: String(err), messageId: inserted.id }, "triage failed"),
      );

      // Transition prospect to AWAITING if not already
      const [p] = await db.select().from(prospects).where(eq(prospects.id, thread.prospectId));
      if (p && !["AWAITING", "RESPONDED", "BOOKED", "WON", "LOST"].includes(p.state)) {
        await transition({
          db,
          prospectId: p.id,
          from: p.state as any,
          to: "AWAITING",
          reason: "inbound_reply",
          triggeredBy: "webhook",
        });
      }
    }

    await db
      .update(threads)
      .set({ lastCheckedAt: new Date() })
      .where(eq(threads.id, thread.id));
  }

  return { acceptedCount, newMessages };
}

async function handleInvitationAccepted(db: DbClient, prospectId: string): Promise<void> {
  const [p] = await db.select().from(prospects).where(eq(prospects.id, prospectId));
  if (!p) return;

  // Mark acceptance timestamp
  await db
    .update(prospects)
    .set({ linkedinInvitationAcceptedAt: new Date() })
    .where(eq(prospects.id, prospectId));

  // Already handled?
  const [existingThread] = await db.select().from(threads).where(eq(threads.prospectId, prospectId));
  const threadId =
    existingThread?.id ??
    (await db.insert(threads).values({ prospectId, channel: "linkedin" }).returning())[0]!.id;

  // Draft a first DM and create a triage row awaiting operator approval
  const draft = await draftFirstDm(p);

  // Create a synthetic "inbound" message representing the acceptance so we can anchor the triage row
  const [systemMsg] = await db
    .insert(messages)
    .values({
      threadId,
      direction: "in",
      channel: "linkedin",
      content: "[Connection request accepted]",
      receivedAt: new Date(),
      externalMessageId: `accept:${p.linkedinInvitationId}`,
    })
    .returning();
  if (!systemMsg) return;

  await db.insert(triage).values({
    messageId: systemMsg.id,
    prospectId,
    kind: "first_dm_after_accept",
    classification: "hot",
    confidence: "0.90",
    summary: `${p.businessName} accepted your connection request`,
    draftResponse: draft,
    reasoning: "Auto-drafted first DM after connection acceptance.",
    priority: "high",
    status: "pending",
  });

  logger.info({ prospectId }, "first-dm drafted for accepted connection");
}
