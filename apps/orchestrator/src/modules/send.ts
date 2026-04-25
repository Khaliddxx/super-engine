import {
  and,
  eq,
  gte,
  count,
  type DbClient,
  type Prospect,
  sendLog,
  threads,
  messages,
} from "@super-engine/db";
import { LINKEDIN_INVITE_PROMPT_V1, FIRST_DM_PROMPT_V1 } from "@super-engine/prompts";
import { OutreachMessageSchema } from "@super-engine/schemas";
import { claudeText, extractJson } from "../integrations/claude.js";
import { sendLinkedInInvite, startChat, sendChatMessage } from "../integrations/unipile.js";
import { env } from "../lib/env.js";
import { isWithinSendWindow } from "../lib/time.js";
import { transition } from "./transitions.js";
import { logger } from "../lib/logger.js";

function firstName(full: string): string {
  return (full || "Operator").split(/\s+/)[0] ?? "Operator";
}

async function sentToday(db: DbClient, kind: "invite" | "dm"): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ c: count() })
    .from(sendLog)
    .where(and(eq(sendLog.kind, kind), eq(sendLog.status, "sent"), gte(sendLog.sentAt, startOfDay)));
  return Number(rows[0]?.c ?? 0);
}

export interface SendGateResult {
  sent: boolean;
  reason?: "deferred_send_window" | "deferred_cap" | "missing_linkedin" | "missing_redesign";
}

/** Draft a connection request note. Returns the body (no subject for LI). */
export async function draftInviteNote(prospect: Prospect): Promise<string> {
  const cfg = env();
  const raw = await claudeText(
    LINKEDIN_INVITE_PROMPT_V1.render({
      business_name: prospect.businessName,
      niche: prospect.niche,
      city: prospect.city ?? "",
      top_issues: prospect.qualificationIssues ?? [],
      redesign_url: prospect.redesignHtmlUrl ?? "",
      operator_first_name: firstName(cfg.OPERATOR_NAME),
    }),
    { maxTokens: 600 },
  );
  const parsed = OutreachMessageSchema.parse(extractJson(raw));
  // Hard-cap at 299 chars
  return parsed.body.slice(0, 299);
}

/** Draft the first DM to send after they accept the connection. */
export async function draftFirstDm(prospect: Prospect): Promise<string> {
  const cfg = env();
  const raw = await claudeText(
    FIRST_DM_PROMPT_V1.render({
      business_name: prospect.businessName,
      niche: prospect.niche,
      city: prospect.city ?? "",
      top_issues: prospect.qualificationIssues ?? [],
      redesign_url: prospect.redesignHtmlUrl ?? "",
      operator_first_name: firstName(cfg.OPERATOR_NAME),
    }),
    { maxTokens: 700 },
  );
  const parsed = OutreachMessageSchema.parse(extractJson(raw));
  return parsed.body;
}

/** Send a LinkedIn connection invite, respecting send window + daily cap. */
export async function sendLinkedInInviteForProspect(
  db: DbClient,
  prospect: Prospect,
  opts: { approvedMessage?: string } = {},
): Promise<SendGateResult> {
  const cfg = env();
  if (!prospect.linkedinUrl) {
    await db.insert(sendLog).values({
      prospectId: prospect.id,
      channel: "linkedin",
      kind: "invite",
      status: "failed",
      error: "missing_linkedin_url",
    });
    return { sent: false, reason: "missing_linkedin" };
  }
  if (!prospect.redesignHtmlUrl) return { sent: false, reason: "missing_redesign" };

  if (!isWithinSendWindow(prospect.timezone, 9, 17)) {
    await db.insert(sendLog).values({
      prospectId: prospect.id,
      channel: "linkedin",
      kind: "invite",
      status: "deferred_send_window",
    });
    return { sent: false, reason: "deferred_send_window" };
  }

  const cap = cfg.LINKEDIN_DAILY_CAP;
  const today = await sentToday(db, "invite");
  if (today >= cap) {
    await db.insert(sendLog).values({
      prospectId: prospect.id,
      channel: "linkedin",
      kind: "invite",
      status: "deferred_cap",
    });
    return { sent: false, reason: "deferred_cap" };
  }

  const message = opts.approvedMessage ?? (await draftInviteNote(prospect));
  if (!cfg.UNIPILE_ACCOUNT_ID || !cfg.UNIPILE_API_KEY || !cfg.UNIPILE_DSN) {
    throw new Error("Unipile credentials not configured");
  }

  const result = await sendLinkedInInvite({
    accountId: cfg.UNIPILE_ACCOUNT_ID,
    linkedinUrl: prospect.linkedinUrl,
    message,
  });

  await db.insert(sendLog).values({
    prospectId: prospect.id,
    channel: "linkedin",
    kind: "invite",
    status: "sent",
    externalRef: result.invitationId,
  });

  // Ensure a thread row exists so we can attach follow-on messages later
  const [existingThread] = await db.select().from(threads).where(eq(threads.prospectId, prospect.id));
  const threadId =
    existingThread?.id ??
    (
      await db
        .insert(threads)
        .values({
          prospectId: prospect.id,
          channel: "linkedin",
          externalThreadId: null,
        })
        .returning()
    )[0]!.id;

  // Record the outbound invite as a message (direction=out, channel=linkedin)
  await db.insert(messages).values({
    threadId,
    direction: "out",
    channel: "linkedin",
    content: message,
    sentAt: new Date(),
    externalMessageId: `invite:${result.invitationId}`,
  });

  await transition({
    db,
    prospectId: prospect.id,
    from: prospect.state as any,
    to: "SENT",
    reason: "linkedin_invite_sent",
    patch: {
      linkedinInvitationId: result.invitationId,
      linkedinProviderId: result.providerId,
      linkedinInvitationSentAt: new Date(),
    },
  });

  logger.info({ prospectId: prospect.id, invitationId: result.invitationId }, "linkedin invite sent");
  return { sent: true };
}

/** Send first DM after the prospect accepted the invite. */
export async function sendFirstDmForProspect(
  db: DbClient,
  prospect: Prospect,
  opts: { approvedMessage: string },
): Promise<SendGateResult> {
  const cfg = env();
  if (!cfg.UNIPILE_ACCOUNT_ID) throw new Error("Unipile account id not configured");
  if (!prospect.linkedinProviderId) return { sent: false, reason: "missing_linkedin" };

  if (!isWithinSendWindow(prospect.timezone, 9, 17)) {
    await db.insert(sendLog).values({
      prospectId: prospect.id,
      channel: "linkedin",
      kind: "dm",
      status: "deferred_send_window",
    });
    return { sent: false, reason: "deferred_send_window" };
  }

  const today = await sentToday(db, "dm");
  if (today >= cfg.LINKEDIN_DAILY_CAP * 2) {
    // DMs to connected prospects are lower-risk; allow ~2x cap
    await db.insert(sendLog).values({
      prospectId: prospect.id,
      channel: "linkedin",
      kind: "dm",
      status: "deferred_cap",
    });
    return { sent: false, reason: "deferred_cap" };
  }

  let chatId = prospect.linkedinChatId;
  let messageId: string;
  if (chatId) {
    const result = await sendChatMessage({ chatId, text: opts.approvedMessage });
    messageId = result.messageId;
  } else {
    const result = await startChat({
      accountId: cfg.UNIPILE_ACCOUNT_ID,
      providerId: prospect.linkedinProviderId,
      text: opts.approvedMessage,
    });
    chatId = result.chatId;
    messageId = result.messageId;
  }

  const [existingThread] = await db.select().from(threads).where(eq(threads.prospectId, prospect.id));
  const threadId =
    existingThread?.id ??
    (
      await db.insert(threads).values({ prospectId: prospect.id, channel: "linkedin", externalThreadId: chatId }).returning()
    )[0]!.id;
  if (existingThread && !existingThread.externalThreadId && chatId) {
    await db.update(threads).set({ externalThreadId: chatId }).where(eq(threads.id, threadId));
  }

  await db.insert(messages).values({
    threadId,
    direction: "out",
    channel: "linkedin",
    content: opts.approvedMessage,
    sentAt: new Date(),
    externalMessageId: messageId,
  });

  await db.insert(sendLog).values({
    prospectId: prospect.id,
    channel: "linkedin",
    kind: "dm",
    status: "sent",
    externalRef: messageId,
  });

  await transition({
    db,
    prospectId: prospect.id,
    from: prospect.state as any,
    to: "AWAITING",
    reason: "first_dm_sent",
    patch: { linkedinChatId: chatId ?? undefined },
  });

  return { sent: true };
}
