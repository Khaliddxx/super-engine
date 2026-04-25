import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export async function notify(text: string, opts: { blocks?: unknown[] } = {}): Promise<void> {
  const url = env().SLACK_WEBHOOK_URL;
  if (!url) {
    logger.debug({ text }, "slack webhook not configured, skipping notify");
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, blocks: opts.blocks }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "slack notify failed");
    }
  } catch (err) {
    logger.warn({ err }, "slack notify threw");
  }
}
