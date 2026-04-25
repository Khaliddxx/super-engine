import { db } from "../lib/db.js";
import { runMarketScout } from "../modules/market-scout.js";

const country = process.argv[2] ?? "AU";
const rows = await runMarketScout(db(), { country, maxCells: 30 });
console.log(`Top 10 markets for ${country}:`);
rows.slice(0, 10).forEach((r, i) => {
  console.log(
    `  ${i + 1}. ${r.niche.padEnd(18)} — ${r.city.padEnd(16)} score=${r.opportunityScore}  count=${r.businessCount}  rating=${r.avgRating}`,
  );
});
process.exit(0);
