import { db } from "../lib/db.js";
import { seedDemoTriage } from "./seed-demo.js";

const n = Number(process.argv[2] ?? 3);
const count = await seedDemoTriage(db(), n);
console.log(`Seeded ${count} demo triage cards.`);
process.exit(0);
