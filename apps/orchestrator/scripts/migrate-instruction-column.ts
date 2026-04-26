// Tiny one-shot to add `redesign_instruction` to the prospects table on the
// live DB without waiting for the orchestrator to redeploy. Idempotent.
import "dotenv/config";
import { createDatabase, sql } from "@super-engine/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const d = createDatabase(url);
  await d.execute(sql`ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "redesign_instruction" text`);
  console.log("ok");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
