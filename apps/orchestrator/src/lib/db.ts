import { createDatabase, type DbClient } from "@super-engine/db";
import { env } from "./env.js";

let cached: DbClient | null = null;

export function db(): DbClient {
  if (cached) return cached;
  cached = createDatabase(env().DATABASE_URL);
  return cached;
}
