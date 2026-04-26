import { createHash, timingSafeEqual } from "node:crypto";
import { eq, operatorSettings, type DbClient } from "@super-engine/db";
import { env } from "./env.js";

function sha256Utf8(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** Timing-safe compare for studio preview password (never stored as plain in HTML). */
export function verifyStudioPreviewPassword(attempt: string, expected: string): boolean {
  if (!expected || !attempt) return false;
  const a = sha256Utf8(attempt);
  const e = sha256Utf8(expected);
  return a.length === e.length && timingSafeEqual(a, e);
}

/** Env overrides DB for operators who prefer secrets in deployment config. */
export async function resolveStudioPreviewPassword(db: DbClient): Promise<string> {
  const cfg = env();
  const fromEnv = (cfg.STUDIO_PREVIEW_EDIT_PASSWORD ?? "").trim();
  if (fromEnv) return fromEnv;
  const key = (cfg.OPERATOR_EMAIL || "operator@local").trim();
  const [s] = await db.select().from(operatorSettings).where(eq(operatorSettings.operatorEmail, key));
  const prefs = s?.preferences as Record<string, unknown> | null | undefined;
  const p = prefs?.studioPreviewEditPassword;
  return typeof p === "string" ? p.trim() : "";
}

export function isStudioPreviewPasswordConfigured(expected: string): boolean {
  return Boolean(expected && expected.length > 0);
}
