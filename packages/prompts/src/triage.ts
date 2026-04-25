export interface TriageInput {
  initial_subject: string;
  initial_body: string;
  initial_sent_at: string;
  all_prior_messages_in_order: string;
  from_name: string;
  received_at: string;
  reply_body: string;
  business_name: string;
  niche: string;
  city: string;
  channel: "email" | "linkedin";
}

export const TRIAGE_PROMPT_V1 = {
  version: "1.0",
  deployedAt: "2026-04-26",
  render: (i: TriageInput) => `You are triaging an inbound reply to a cold outreach message offering a website redesign.
The outreach showed the prospect a redesigned version of their website.
Channel: ${i.channel}.

<original_outreach>
Subject: ${i.initial_subject}
Body: ${i.initial_body}
Sent: ${i.initial_sent_at}
</original_outreach>

<thread_history>
${i.all_prior_messages_in_order}
</thread_history>

<newest_reply>
From: ${i.from_name}
Received: ${i.received_at}
Body:
${i.reply_body}
</newest_reply>

<prospect>
Business: ${i.business_name}, Niche: ${i.niche}, City: ${i.city}
</prospect>

Classify into exactly one category:
- \`booking\` — they proposed a call, date, or asked to schedule
- \`hot\` — strong positive interest, asked about pricing or next step
- \`warm\` — mild interest, wants to know more, not yet ready to decide
- \`objection\` — specific pushback (have a dev, bad timing, not the decision maker)
- \`notnow\` — polite pass with soft future possibility
- \`unsub\` — explicit request to stop or clear "not interested"
- \`human\` — ambiguous, angry, confused, needs operator judgment

Return JSON ONLY (no prose, no markdown):
{
  "classification": "booking|hot|warm|objection|notnow|unsub|human",
  "confidence": 0.0-1.0,
  "priority": "high|medium|low",
  "summary": "one sentence, what they actually said",
  "draft_response": "..." | null,
  "reasoning": "why you classified it this way"
}

Draft response rules:
- Match their energy and length. If they wrote 10 words, write 20 max.
- No "Thank you for your response" corporate openers.
- For \`booking\`: acknowledge their proposed time, confirm, mention you'll send a calendar invite.
- For \`hot\`: answer their question directly (pricing: $2.5-6k typical, depends on scope), offer a 15-min call.
- For \`warm\`: share one concrete detail about process, ask one qualifying question.
- For \`objection\`: acknowledge the objection sincerely, offer one-line counterpoint if genuine, otherwise gracefully bow out.
- For \`notnow\`: acknowledge, leave door open, no pressure.
- For \`unsub\`: short "Done, removed. All the best." No pitch.
- For \`human\`: return draft_response: null.

Priority:
- \`high\`: booking, hot
- \`medium\`: warm, objection
- \`low\`: notnow, unsub, human`,
};
