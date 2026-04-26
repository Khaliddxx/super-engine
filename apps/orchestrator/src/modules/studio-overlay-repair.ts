import {
  deployments,
  eq,
  desc,
  asc,
  prospects,
  isNotNull,
  type DbClient,
  type Prospect,
} from "@super-engine/db";
import { deployStaticSite, type StaticSiteFile } from "../integrations/vercel.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { buildStudioOverlay, injectOverlay } from "./redesign.js";

const MAX_HTML_FETCH = 400_000;
const MAX_ASSET_BYTES_TOTAL = 40 * 1024 * 1024;
const MAX_ASSET_FILES = 200;
const MAX_ASSET_PER_FILE = 6 * 1024 * 1024;

function normalizeSiteBase(raw: string): URL {
  const u = new URL(raw);
  u.hash = "";
  u.search = "";
  return u;
}

function pageFetchHref(base: URL, slug: string): string {
  const s = slug.replace(/^\//, "");
  if (s === "index.html") {
    return new URL("/", base).href;
  }
  return new URL("/" + s, base).href;
}

function pageSlugsFromVariant(v: unknown): string[] {
  if (!v || typeof v !== "object") return ["index.html"];
  const slugs = (v as { pageSlugs?: unknown }).pageSlugs;
  if (!Array.isArray(slugs) || !slugs.every((x) => typeof x === "string")) {
    return ["index.html"];
  }
  const norm = slugs.map((s) => {
    const t = String(s).trim();
    return t.endsWith(".html") ? t : `${t}.html`;
  });
  const set = new Set(norm);
  if (!set.has("index.html")) set.add("index.html");
  return [...set];
}

function shouldSkipHref(src: string): boolean {
  const t = src.trim();
  if (!t || t.startsWith("#")) return true;
  if (/^(https?:|\/\/|data:|mailto:|tel:|javascript:)/i.test(t)) return true;
  return false;
}

function filePathFromPathname(pathname: string): string | null {
  const p = pathname.replace(/^\/+/, "");
  if (!p || p.endsWith("/")) return null;
  return decodeURIComponent(p);
}

function collectRelativeAssetPaths(html: string, pageHref: string, base: URL): string[] {
  const pageUrl = new URL(pageHref);
  const out: string[] = [];
  const attrRe = /(?:\bsrc|\bhref)\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(html)) !== null) {
    const raw = m[1]!;
    if (shouldSkipHref(raw)) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (resolved.origin !== base.origin) continue;
    const path = filePathFromPathname(resolved.pathname);
    if (!path) continue;
    if (/\.html?$/i.test(path)) continue;
    out.push(path);
  }
  return out;
}

export type StudioOverlayRepairResult =
  | { status: "skipped"; reason: "no_preview_url" | "already_present" }
  | { status: "repaired"; url: string; warnings: string[] }
  | { status: "error"; message: string };

/**
 * Fetches the live redesign preview, injects the studio banner on any HTML page
 * that is missing it, and redeploys. Safe to call repeatedly (no-op when overlay
 * already exists on every page).
 */
export async function ensureStudioOverlayOnLivePreview(
  db: DbClient,
  prospect: Prospect,
): Promise<StudioOverlayRepairResult> {
  const previewUrl = prospect.redesignHtmlUrl?.trim();
  if (!previewUrl) return { status: "skipped", reason: "no_preview_url" };

  const [latest] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.prospectId, prospect.id))
    .orderBy(desc(deployments.createdAt))
    .limit(1);

  const base = normalizeSiteBase(previewUrl);
  const slugs = latest ? pageSlugsFromVariant(latest.variantJson) : ["index.html"];

  const htmlBySlug = new Map<string, string>();
  const warnings: string[] = [];

  for (const slug of slugs) {
    const href = pageFetchHref(base, slug);
    try {
      const res = await fetch(href, { redirect: "follow" });
      if (!res.ok) {
        warnings.push(`fetch ${slug}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (text.length > MAX_HTML_FETCH) {
        warnings.push(`fetch ${slug}: HTML too large, truncating`);
        htmlBySlug.set(slug, text.slice(0, MAX_HTML_FETCH));
      } else {
        htmlBySlug.set(slug, text);
      }
    } catch (e) {
      warnings.push(`fetch ${slug}: ${String(e)}`);
    }
  }

  for (const slug of slugs) {
    if (!htmlBySlug.has(slug) || !htmlBySlug.get(slug)?.trim()) {
      return { status: "error", message: `missing_page:${slug}` };
    }
  }

  const cfg = env();
  const opEmail = (cfg.OPERATOR_EMAIL ?? "").trim();
  const overlayHtml = buildStudioOverlay({
    displayName: cfg.STUDIO_DISPLAY_NAME,
    tagline: cfg.STUDIO_TAGLINE,
    bookingUrl: (cfg.STUDIO_BOOKING_URL as string | undefined) || "",
    businessName: prospect.businessName,
    fallbackMailto:
      opEmail && opEmail.includes("@")
        ? `mailto:${opEmail}?subject=${encodeURIComponent("Book a 15-min call")}`
        : undefined,
    prospectId: prospect.id,
    pwaAppUrl: (cfg.PWA_APP_URL ?? "").trim() || undefined,
  });

  const outHtml = new Map<string, string>();
  let overlayChanged = false;
  for (const slug of slugs) {
    const h = htmlBySlug.get(slug)!;
    const next = injectOverlay(h, overlayHtml);
    if (next !== h) overlayChanged = true;
    outHtml.set(slug, next);
  }
  if (!overlayChanged) {
    return { status: "skipped", reason: "already_present" };
  }

  const assetPaths = new Set<string>();
  for (const slug of slugs) {
    const html = htmlBySlug.get(slug);
    if (!html) continue;
    const href = pageFetchHref(base, slug);
    for (const p of collectRelativeAssetPaths(html, href, base)) {
      assetPaths.add(p);
    }
  }

  const files: StaticSiteFile[] = [];
  for (const [slug, data] of outHtml) {
    files.push({ file: slug, data, encoding: "utf8" });
  }

  let assetBytes = 0;
  let assetCount = 0;
  for (const rel of assetPaths) {
    if (assetCount >= MAX_ASSET_FILES) {
      warnings.push("asset cap reached; some files omitted");
      break;
    }
    const assetUrl = new URL("/" + rel.replace(/^\/+/, ""), base).href;
    try {
      const res = await fetch(assetUrl, { redirect: "follow" });
      if (!res.ok) {
        warnings.push(`asset ${rel}: HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_ASSET_PER_FILE) {
        warnings.push(`asset ${rel}: too large, skipped`);
        continue;
      }
      if (assetBytes + buf.length > MAX_ASSET_BYTES_TOTAL) {
        warnings.push("total asset size cap reached");
        break;
      }
      assetBytes += buf.length;
      assetCount++;
      files.push({
        file: rel.replace(/^\/+/, ""),
        data: buf.toString("base64"),
        encoding: "base64",
      });
    } catch (e) {
      warnings.push(`asset ${rel}: ${String(e)}`);
    }
  }

  try {
    const deploy = await deployStaticSite({
      files,
      businessName: prospect.businessName,
      prospectId: prospect.id,
    });

    const indexOut = outHtml.get("index.html") ?? "";

    const nextVariant = {
      ...(typeof latest?.variantJson === "object" && latest?.variantJson !== null ? latest.variantJson : {}),
      pageSlugs: slugs,
      studioOverlayRepair: { at: new Date().toISOString() },
    };

    await db.insert(deployments).values({
      prospectId: prospect.id,
      vercelDeploymentId: deploy.deploymentId,
      url: deploy.url,
      htmlContent: indexOut,
      variantJson: nextVariant as Record<string, unknown>,
    });

    await db
      .update(prospects)
      .set({
        redesignHtmlUrl: deploy.url,
        redesignDeployedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(prospects.id, prospect.id));

    logger.info(
      { prospectId: prospect.id, url: deploy.url, warnings: warnings.length },
      "studio overlay repair redeployed",
    );

    return { status: "repaired", url: deploy.url, warnings };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

let repairPassInFlight = false;

/**
 * Walk prospects with a live preview URL and repair missing studio banners.
 * Oldest `redesignDeployedAt` first so backfill eventually covers the full backlog.
 */
export async function runStudioOverlayRepairPass(
  db: DbClient,
  opts?: { maxProspects?: number },
): Promise<{ examined: number; repaired: number; skipped: number; errors: number }> {
  if (repairPassInFlight) {
    return { examined: 0, repaired: 0, skipped: 0, errors: 0 };
  }
  repairPassInFlight = true;
  const maxProspects = opts?.maxProspects ?? 60;
  let examined = 0;
  let repaired = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const rows = await db
      .select()
      .from(prospects)
      .where(isNotNull(prospects.redesignHtmlUrl))
      .orderBy(asc(prospects.redesignDeployedAt))
      .limit(maxProspects);

    for (const p of rows) {
      examined++;
      try {
        const r = await ensureStudioOverlayOnLivePreview(db, p);
        if (r.status === "repaired") repaired++;
        else if (r.status === "skipped") skipped++;
        else errors++;
      } catch (e) {
        errors++;
        logger.warn({ prospectId: p.id, err: String(e) }, "studio overlay repair threw");
      }
    }

    if (repaired > 0 || errors > 0) {
      logger.info({ examined, repaired, skipped, errors }, "studio overlay repair pass");
    }

    return { examined, repaired, skipped, errors };
  } finally {
    repairPassInFlight = false;
  }
}
