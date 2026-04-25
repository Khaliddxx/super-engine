import { ServerEnvSchema, type ServerEnv } from "@super-engine/schemas";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: process.env.ENV_FILE ?? ".env" });
loadDotenv({ path: "../../.env" });

let cachedEnv: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cachedEnv) return cachedEnv;
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Environment validation failed:");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}
