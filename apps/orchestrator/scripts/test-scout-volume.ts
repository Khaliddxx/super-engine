// Quick smoke test: verify the new multi-query Places scout actually returns
// substantially more candidates than the single-query path.
//
// Run from repo root:
//   pnpm exec tsx apps/orchestrator/scripts/test-scout-volume.ts "nightclub" "Bangkok"
//
// Reads no env beyond GOOGLE_PLACES_API_KEY. Does NOT touch the DB.

import "dotenv/config";
import { textSearch, textSearchMulti } from "../src/integrations/places.js";
import { buildSearchVariants } from "../src/modules/scrape.js";

async function main() {
  const niche = process.argv[2] ?? "nightclub";
  const city = process.argv[3] ?? "Bangkok";

  console.log(`\nNiche: ${niche}\nCity:  ${city}\n`);

  const variants = buildSearchVariants(niche, city);
  console.log(`Generated ${variants.length} query variants:`);
  for (const v of variants) console.log(`  • ${v}`);
  console.log();

  console.log("Single-query baseline (old behavior):");
  const single = await textSearch(`${niche} in ${city}`, { max: 20 });
  console.log(`  → ${single.length} results\n`);

  console.log("Single query with pagination (60 cap):");
  const paged = await textSearch(`${niche} in ${city}`, { max: 60 });
  console.log(`  → ${paged.length} results\n`);

  console.log("Multi-query (new behavior):");
  const multi = await textSearchMulti(variants, { maxPerQuery: 60, totalMax: 240 });
  console.log(`  → ${multi.length} unique businesses\n`);

  const withSite = multi.filter((p) => !!p.website).length;
  console.log(`Of which ${withSite} have a website (the only ones we'd consider).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
