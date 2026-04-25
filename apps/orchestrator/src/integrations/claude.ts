import Anthropic from "@anthropic-ai/sdk";
import { env } from "../lib/env.js";

let cached: Anthropic | null = null;

export function claude(): Anthropic {
  if (cached) return cached;
  cached = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  return cached;
}

export const CLAUDE_MODEL = () => env().CLAUDE_MODEL;

export async function claudeText(
  prompt: string,
  opts: { maxTokens?: number; model?: string; temperature?: number } = {},
): Promise<string> {
  const res = await claude().messages.create({
    model: opts.model ?? CLAUDE_MODEL(),
    max_tokens: opts.maxTokens ?? 4000,
    ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
    messages: [{ role: "user", content: prompt }],
  });
  const block = res.content[0];
  if (!block || block.type !== "text") throw new Error("No text content in Claude response");
  return block.text;
}

export async function claudeVision(
  prompt: string,
  imageUrl: string,
  opts: { maxTokens?: number; model?: string } = {},
): Promise<string> {
  // Fetch the image and pass it as base64 to avoid URL-source limitations
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch screenshot: ${imgRes.status}`);
  const contentType = imgRes.headers.get("content-type") ?? "image/png";
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const base64 = buf.toString("base64");

  const res = await claude().messages.create({
    model: opts.model ?? CLAUDE_MODEL(),
    max_tokens: opts.maxTokens ?? 2000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: contentType as "image/png" | "image/jpeg", data: base64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  const block = res.content[0];
  if (!block || block.type !== "text") throw new Error("No text content in Claude vision response");
  return block.text;
}

export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1]! : text;
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error(`No JSON object found in response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as T;
}
