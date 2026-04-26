import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { env } from "../lib/env.js";

/** Anthropic vision limit is 5 MB base64 payload; stay under with margin. */
const VISION_IMAGE_MAX_BYTES = 4_000_000;

async function bufferToVisionPayload(
  buf: Buffer,
  contentType: string,
): Promise<{ data: string; mediaType: "image/png" | "image/jpeg" }> {
  let ct = (contentType.split(";")[0] ?? "image/png").trim();
  let b = buf;
  if (b.length > VISION_IMAGE_MAX_BYTES || !/^image\/(png|jpeg|jpg)$/i.test(ct)) {
    b = await sharp(b)
      .rotate()
      .resize({ width: 1600, height: 1200, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    ct = "image/jpeg";
  }
  const mediaType: "image/png" | "image/jpeg" = ct.toLowerCase().includes("png") ? "image/png" : "image/jpeg";
  return { data: b.toString("base64"), mediaType };
}

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
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch screenshot: ${imgRes.status}`);
  const contentType = imgRes.headers.get("content-type") ?? "image/png";
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const { data: base64, mediaType } = await bufferToVisionPayload(buf, contentType);

  const res = await claude().messages.create({
    model: opts.model ?? CLAUDE_MODEL(),
    max_tokens: opts.maxTokens ?? 2000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  const block = res.content[0];
  if (!block || block.type !== "text") throw new Error("No text content in Claude vision response");
  return block.text;
}

export async function claudeVisionMulti(
  prompt: string,
  imageUrls: string[],
  opts: { maxTokens?: number; model?: string } = {},
): Promise<string> {
  const images = await Promise.all(
    imageUrls.map(async (imageUrl) => {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error(`Failed to fetch screenshot: ${imgRes.status}`);
      const contentType = imgRes.headers.get("content-type") ?? "image/png";
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const { data, mediaType } = await bufferToVisionPayload(buf, contentType);
      return {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mediaType,
          data,
        },
      };
    }),
  );

  const res = await claude().messages.create({
    model: opts.model ?? CLAUDE_MODEL(),
    max_tokens: opts.maxTokens ?? 2400,
    messages: [
      {
        role: "user",
        content: [...images, { type: "text", text: prompt }],
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
