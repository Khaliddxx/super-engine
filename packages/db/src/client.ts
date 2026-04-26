import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(databaseUrl: string) {
  const queryClient = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    // postgres.js defaults to console.log for every NOTICE. Our boot migrations
    // use ADD COLUMN IF NOT EXISTS, which still emits 42701 "already exists"
    // for each existing column — very noisy in dev.
    onnotice: (notice) => {
      if (notice.code === "42701") return;
      console.warn("[postgres notice]", notice.message);
    },
  });
  return drizzle(queryClient, { schema, logger: false });
}

export type DbClient = ReturnType<typeof createDatabase>;
