import { eq, desc, type DbClient, messages, threads, prospects, triage } from "@super-engine/db";
import { TRIAGE_PROMPT_V1 } from "@super-engine/prompts";
import { TriageResultSchema } from "@super-engine/schemas";
import { claudeText, extractJson } from "../integrations/claude.js";
import { notify } from "../integrations/slack.js";
import { logger } from "../lib/logger.js";

export async function triageMessage(db: DbClient, messageId: string): Promise<void> {
  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!msg) throw new Error(`Message ${messageId} not found`);

  const [thread] = await db.select().from(threads).where(eq(threads.id, msg.threadId));
  if (!thread) throw new Error(`Thread ${msg.threadId} not found`);

  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, thread.prospectId));
  if (!prospect) throw new Error(`Prospect ${thread.prospectId} not found`);

  // Load the thread history (up to 20 most recent)
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, thread.id))
    .orderBy(desc(messages.createdAt))
    .limit(20);
  const ordered = history.slice().reverse();

  const initial = ordered.find((m) => m.direction === "out");
  const historyText = ordered
    .map((m) => `${m.direction === "in" ? "THEM" : "US"} (${(m.sentAt ?? m.receivedAt ?? m.createdAt).toISOString?.() ?? ""}): ${m.content}`)
    .join("\n");

  const prompt = TRIAGE_PROMPT_V1.render({
    initial_subject: initial?.subject ?? "(LinkedIn)",
    initial_body: initial?.content ?? "",
    initial_sent_at: initial?.sentAt?.toISOString() ?? "",
    all_prior_messages_in_order: historyText,
    from_name: prospect.businessName,
    received_at: (msg.receivedAt ?? msg.createdAt).toISOString(),
    reply_body: msg.content,
    business_name: prospect.businessName,
    niche: prospect.niche,
    city: prospect.city ?? "",
    channel: (thread.channel === "email" ? "email" : "linkedin") as "email" | "linkedin",
  });

  let parsed;
  try {
    const raw = await claudeText(prompt, { maxTokens: 1500 });
    parsed = TriageResultSchema.parse(extractJson(raw));
  } catch (err) {
    logger.warn({ err: String(err), messageId }, "triage claude/parse failed, defaulting to human");
    parsed = {
      classification: "human" as const,
      confidence: 0.5,
      priority: "medium" as const,
      summary: msg.content.slice(0, 140),
      draft_response: null,
      reasoning: "Triage parser failed, needs human review.",
    };
  }

  // Apply confidence floor
  if (parsed.confidence < 0.75 && parsed.classification !== "unsub") {
    parsed.classification = "human";
    parsed.draft_response = null;
  }

  await db.insert(triage).values({
    messageId,
    prospectId: prospect.id,
    kind: "reply",
    classification: parsed.classification,
    confidence: parsed.confidence.toFixed(2),
    summary: parsed.summary,
    draftResponse: parsed.draft_response ?? null,
    reasoning: parsed.reasoning,
    priority: parsed.priority,
    status: "pending",
  });

  logger.info({ prospectId: prospect.id, classification: parsed.classification }, "triage classified");

  // Slack alert for high-priority classifications
  if (parsed.priority === "high" || parsed.classification === "booking" || parsed.classification === "hot") {
    await notify(
      `:rocket: *${parsed.classification.toUpperCase()}* from *${prospect.businessName}* (${prospect.city ?? "?"}): ${parsed.summary}`,
    );
  }
}
