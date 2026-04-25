import { db } from "../lib/db.js";
import { runPipelineCycle } from "../modules/scheduler.js";

const counts = await runPipelineCycle(db());
console.log("Pipeline cycle complete:", counts);
process.exit(0);
