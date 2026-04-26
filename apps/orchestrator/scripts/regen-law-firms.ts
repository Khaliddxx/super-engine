// One-shot: re-run the redesign on every law-firm prospect using the new V3
// archetype-driven prompt. We run it directly in this process so the operator
// doesn't have to wait for the orchestrator's pipeline cycle.
//
// Run from repo root:  pnpm exec tsx apps/orchestrator/scripts/regen-law-firms.ts
//
// Safety: handleRedesignFailure preserves any working preview, so a failed
// regen never loses the existing redesignHtmlUrl.

import "dotenv/config";
import { createDatabase, prospects, eq, ilike, or } from "@super-engine/db";
import { redesignProspect } from "../src/modules/redesign.js";
import { transition } from "../src/modules/transitions.js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const d = createDatabase(url);

  // Match niche LIKE %law% OR business name containing "law" — covers
  // the obvious cases without hardcoding IDs.
  const candidates = await d
    .select({
      id: prospects.id,
      businessName: prospects.businessName,
      niche: prospects.niche,
      state: prospects.state,
      redesignHtmlUrl: prospects.redesignHtmlUrl,
    })
    .from(prospects)
    .where(
      or(
        ilike(prospects.niche, "%law%"),
        ilike(prospects.businessName, "%law%"),
      ),
    );

  if (candidates.length === 0) {
    console.log("No law-firm prospects found.");
    return;
  }

  console.log(`Found ${candidates.length} law-firm prospects:`);
  for (const c of candidates) {
    console.log(`  - ${c.businessName}  state=${c.state}  niche=${c.niche}`);
  }

  let succeeded = 0;
  let failed = 0;
  for (const c of candidates) {
    if (!["REDESIGNED", "QUALIFIED", "APPROVED_TO_SEND"].includes(c.state)) {
      console.log(`\n>> SKIP ${c.businessName} — state ${c.state} (not regenerable)`);
      continue;
    }

    console.log(`\n>> Regenerating ${c.businessName} (${c.id})…`);
    try {
      // We need the prospect to be in QUALIFIED state for redesignProspect to
      // transition cleanly into REDESIGNED at the end. handleRedesignFailure
      // bounces it back to REDESIGNED preserving the old URL if anything
      // breaks, so this is safe.
      if (c.state !== "QUALIFIED") {
        await transition({
          db: d,
          prospectId: c.id,
          from: c.state as any,
          to: "QUALIFIED",
          reason: "regen_law_firms_script",
          triggeredBy: "operator_script",
        });
      }
      const [refreshed] = await d.select().from(prospects).where(eq(prospects.id, c.id));
      if (!refreshed) {
        console.log(`   ! disappeared after transition`);
        failed++;
        continue;
      }
      await redesignProspect(d, refreshed);
      const [after] = await d
        .select({ state: prospects.state, url: prospects.redesignHtmlUrl })
        .from(prospects)
        .where(eq(prospects.id, c.id));
      console.log(`   ✓ done — state=${after?.state} url=${after?.url ?? "(none)"}`);
      succeeded++;
    } catch (err) {
      console.log(`   ! failed: ${String(err).slice(0, 200)}`);
      failed++;
    }
  }

  console.log(`\nDone. ${succeeded} regenerated, ${failed} failed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
