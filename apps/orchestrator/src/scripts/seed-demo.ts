import { eq, type DbClient, campaigns, prospects, threads, messages, triage } from "@super-engine/db";

export async function seedDemoTriage(db: DbClient, n = 3): Promise<number> {
  const [existing] = await db.select().from(campaigns).where(eq(campaigns.name, "Demo Campaign"));
  const campaignId =
    existing?.id ??
    (
      await db
        .insert(campaigns)
        .values({
          name: "Demo Campaign",
          niche: "nail salon",
          targetCity: "Sydney",
          targetCountry: "AU",
          outreachChannel: "both",
          imageryStrategy: "none",
        })
        .returning()
    )[0]!.id;

  const demos = [
    {
      businessName: "Orchid Nails & Spa",
      niche: "nail salon",
      city: "Sydney",
      replyBody:
        "Hi — thanks for the preview, looks great honestly. What would something like this cost end-to-end? Could we jump on a quick call next week?",
      classification: "hot" as const,
      priority: "high" as const,
      summary: "Asked about pricing and wants a call next week.",
      draft:
        "Love to. Pricing is usually $2.5-6k depending on scope (copy rewrite, booking integration, photography). Free tomorrow 2pm or Thursday 11am your time — which works?",
      reasoning: "Clear positive intent + explicit ask for a call and pricing → hot.",
    },
    {
      businessName: "Meridian Dental",
      niche: "dentist",
      city: "Melbourne",
      replyBody:
        "Does Wednesday 3pm Melbourne time work for a 15 min chat? Want to see if this is a fit before the summer rush.",
      classification: "booking" as const,
      priority: "high" as const,
      summary: "Proposed Wednesday 3pm Melbourne time for a 15-min call.",
      draft:
        "Wednesday 3pm Melbourne time works. I'll send a calendar invite shortly with a Meet link. Talk soon — Khalid",
      reasoning: "Explicit time proposed → booking.",
    },
    {
      businessName: "Blackbird Coffee Co.",
      niche: "cafe",
      city: "Brisbane",
      replyBody:
        "Appreciate the note — we've actually got a dev on retainer so we're sorted on the web side. Good luck though!",
      classification: "objection" as const,
      priority: "medium" as const,
      summary: "Has a dev on retainer, not interested right now.",
      draft:
        "All good — thanks for taking a look. If your retainer ever lapses, the preview is yours. Best of luck with the rush.",
      reasoning: "Has existing solution, polite decline.",
    },
  ].slice(0, n);

  let created = 0;
  for (const d of demos) {
    const [p] = await db
      .insert(prospects)
      .values({
        campaignId,
        state: "AWAITING",
        businessName: d.businessName,
        niche: d.niche,
        city: d.city,
        country: "AU",
        website: `https://${d.businessName.toLowerCase().replace(/[^a-z0-9]/g, "")}.example`,
        email: `info@${d.businessName.toLowerCase().replace(/[^a-z0-9]/g, "")}.example`,
        linkedinUrl: `https://linkedin.com/in/${d.businessName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
        redesignHtmlUrl: "https://preview-demo.vercel.app",
        variantPalette: "warm-ivory",
        variantFonts: "editorial",
        variantLayout: "hero-split",
        qualificationScore: "2.3",
        qualificationIssues: ["dated typography", "no mobile CTA", "broken image links"],
        qualificationReasoning: "Site is clearly dated, but the business has an active review stream.",
      })
      .returning();
    if (!p) continue;

    const [thread] = await db
      .insert(threads)
      .values({
        prospectId: p.id,
        channel: "linkedin",
        externalThreadId: `demo-chat-${p.id}`,
      })
      .returning();

    const [outMsg] = await db
      .insert(messages)
      .values({
        threadId: thread!.id,
        direction: "out",
        channel: "linkedin",
        content:
          "Hi — built a redesigned preview of your site with a clearer booking flow + a mobile hero. Happy to share the link if useful.",
        sentAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        externalMessageId: `demo-out-${p.id}`,
      })
      .returning();

    const [inMsg] = await db
      .insert(messages)
      .values({
        threadId: thread!.id,
        direction: "in",
        channel: "linkedin",
        content: d.replyBody,
        receivedAt: new Date(),
        externalMessageId: `demo-in-${p.id}`,
      })
      .returning();

    await db.insert(triage).values({
      messageId: inMsg!.id,
      prospectId: p.id,
      kind: "reply",
      classification: d.classification,
      confidence: "0.92",
      summary: d.summary,
      draftResponse: d.draft,
      reasoning: d.reasoning,
      priority: d.priority,
      status: "pending",
    });

    created++;
  }

  return created;
}
