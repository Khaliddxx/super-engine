// One-shot script: restore prospects that have a working redesign_html_url
// but were knocked back into REJECTED by recent qualify/redesign changes.
//
// We never create or destroy prospect data here — only flip the state column
// for rows that already have a preserved preview URL, and record the event in
// the `state_transitions` audit table.
//
// Run from repo root:  node apps/orchestrator/scripts/restore-redesigned.mjs

import "dotenv/config";
import { createDatabase, prospects, stateTransitions, eq, and, isNotNull } from "@super-engine/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const d = createDatabase(url);

  const candidates = await d
    .select({
      id: prospects.id,
      businessName: prospects.businessName,
      state: prospects.state,
      rejectionReason: prospects.rejectionReason,
      redesignHtmlUrl: prospects.redesignHtmlUrl,
    })
    .from(prospects)
    .where(and(eq(prospects.state, "REJECTED"), isNotNull(prospects.redesignHtmlUrl)));

  console.log(`Found ${candidates.length} REJECTED prospects with a preserved redesignHtmlUrl:`);
  for (const c of candidates) {
    console.log(`  - ${c.id}  ${c.businessName}  reason=${c.rejectionReason}`);
    console.log(`      url=${c.redesignHtmlUrl}`);
  }

  if (candidates.length === 0) {
    console.log("\nNothing to restore. Exiting.");
    return;
  }

  for (const c of candidates) {
    await d
      .update(prospects)
      .set({
        state: "REDESIGNED",
        rejectionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(prospects.id, c.id));

    await d.insert(stateTransitions).values({
      prospectId: c.id,
      fromState: "REJECTED",
      toState: "REDESIGNED",
      reason: "manual_restore_after_regen_failure",
      triggeredBy: "operator_script",
      triggeredById: "restore-redesigned.mjs",
      metadata: { previousReason: c.rejectionReason ?? null },
    });
  }

  console.log(`\nRestored ${candidates.length} prospects to REDESIGNED.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Restore failed:", err);
    process.exit(1);
  });
