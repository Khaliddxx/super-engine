/**
 * READ-ONLY diagnostic: lists prospects whose redesign was lost.
 * Shows whether their old preview URL is still preserved in DB so we can
 * decide whether to restore the state.
 */
import "dotenv/config";
import { createDatabase, prospects, eq, desc, isNotNull, and, or } from "@super-engine/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDatabase(url);

const rows = await db
  .select({
    id: prospects.id,
    name: prospects.businessName,
    state: prospects.state,
    rejectionReason: prospects.rejectionReason,
    redesignHtmlUrl: prospects.redesignHtmlUrl,
    redesignDeployedAt: prospects.redesignDeployedAt,
    qualificationReasoning: prospects.qualificationReasoning,
    updatedAt: prospects.updatedAt,
  })
  .from(prospects)
  .where(
    or(
      eq(prospects.state, "REDESIGNED"),
      and(eq(prospects.state, "REJECTED"), isNotNull(prospects.redesignHtmlUrl)),
    ),
  )
  .orderBy(desc(prospects.updatedAt))
  .limit(30);

const summary = {
  redesigned: rows.filter((r) => r.state === "REDESIGNED").length,
  rejected_with_old_url: rows.filter((r) => r.state === "REJECTED" && r.redesignHtmlUrl).length,
};

console.log("Summary:", summary);
console.log("Sample:");
for (const r of rows) {
  console.log(
    JSON.stringify(
      {
        id: r.id.slice(0, 8),
        name: r.name,
        state: r.state,
        rejectionReason: r.rejectionReason,
        hasOldUrl: Boolean(r.redesignHtmlUrl),
        oldUrl: r.redesignHtmlUrl,
        deployedAt: r.redesignDeployedAt,
        updated: r.updatedAt,
      },
      null,
      0,
    ),
  );
}

process.exit(0);
