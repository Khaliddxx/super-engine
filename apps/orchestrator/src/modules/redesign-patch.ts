import { deployments, eq, desc, prospects, type DbClient, type Prospect } from "@super-engine/db";
import { claudeText } from "../integrations/claude.js";
import { deployStaticSite, type StaticSiteFile } from "../integrations/vercel.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

const MAX_HTML_FETCH = 400_000;
const MAX_CLAUDE_INPUT = 120_000;
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

function stripCodeFences(s: string): string {
  return s
    .replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/** First <nav>...</nav> (non-greedy); sufficient when nav is not nested. */
function replaceFirstNavMarkup(html: string, newNav: string): { html: string; ok: boolean } {
  const re = /<nav\b[\s\S]*?<\/nav>/i;
  if (!re.test(html)) return { html, ok: false };
  return { html: html.replace(re, newNav.trim()), ok: true };
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

function navbarPatchModel(): string {
  const cfg = env();
  const m = (cfg.NAVBAR_PATCH_MODEL ?? "").trim();
  if (m) return m;
  return cfg.CLAUDE_MODEL;
}

async function claudeNavbarMarkup(indexHtml: string, instruction: string): Promise<string> {
  const slice = indexHtml.length > MAX_CLAUDE_INPUT ? indexHtml.slice(0, MAX_CLAUDE_INPUT) : indexHtml;
  const prompt = `You edit static HTML microsites. The operator wants ONLY the primary navigation bar changed.

Return a single complete HTML element: one opening <nav ...> tag through its matching closing </nav>. No markdown, no backticks, no commentary before or after.

Rules:
- Keep the same general link destinations (href paths) unless the instruction explicitly asks to rename or reorder items.
- Match the visual style of the existing nav (classes, structure) as much as possible while applying the instruction.
- Do not add scripts. Do not change footer or main content.

Operator instruction:
${instruction.trim()}

Current page HTML (index; excerpt may be truncated):
${slice}`;

  const raw = await claudeText(prompt, { model: navbarPatchModel(), maxTokens: 8000, temperature: 0.3 });
  let nav = stripCodeFences(raw);
  if (!/<nav\b/i.test(nav)) {
    const grab = nav.match(/(<nav\b[\s\S]*<\/nav>)/i);
    if (grab) nav = grab[1]!;
  }
  if (!/<nav\b/i.test(nav) || !/<\/nav>/i.test(nav)) {
    throw new Error("Model did not return a complete <nav> element");
  }
  return nav.trim();
}

export interface PatchRedesignNavbarResult {
  url: string;
  warnings: string[];
}

export async function patchRedesignNavbar(
  db: DbClient,
  prospect: Prospect,
  body: { scope: "navbar"; instruction: string },
): Promise<PatchRedesignNavbarResult> {
  const instruction = body.instruction?.trim() ?? "";
  if (!instruction) throw new Error("instruction_required");
  if (body.scope !== "navbar") throw new Error("unsupported_scope");

  const previewUrl = prospect.redesignHtmlUrl?.trim();
  if (!previewUrl) throw new Error("no_redesign_url");

  const [latest] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.prospectId, prospect.id))
    .orderBy(desc(deployments.createdAt))
    .limit(1);

  if (!latest) throw new Error("no_deployment");

  const base = normalizeSiteBase(previewUrl);
  const slugs = pageSlugsFromVariant(latest.variantJson);

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
      throw new Error(`missing_page:${slug}`);
    }
  }

  if (!htmlBySlug.get("index.html")?.trim()) {
    throw new Error("index_html_missing");
  }

  const indexHtml = htmlBySlug.get("index.html")!;
  const newNav = await claudeNavbarMarkup(indexHtml, instruction);

  const patchedHtml = new Map<string, string>();
  for (const [slug, html] of htmlBySlug) {
    const { html: next, ok } = replaceFirstNavMarkup(html, newNav);
    if (!ok) warnings.push(`no <nav> in ${slug}; skipped`);
    patchedHtml.set(slug, ok ? next : html);
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
  for (const [slug, data] of patchedHtml) {
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

  const deploy = await deployStaticSite({
    files,
    businessName: prospect.businessName,
    prospectId: prospect.id,
  });

  const patchedIndex = patchedHtml.get("index.html") ?? indexHtml;

  const nextVariant = {
    ...(typeof latest.variantJson === "object" && latest.variantJson !== null ? latest.variantJson : {}),
    navbarPatch: {
      at: new Date().toISOString(),
      instruction,
      model: navbarPatchModel(),
    },
  };

  await db.insert(deployments).values({
    prospectId: prospect.id,
    vercelDeploymentId: deploy.deploymentId,
    url: deploy.url,
    htmlContent: patchedIndex,
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
    "navbar patch redeployed",
  );

  return { url: deploy.url, warnings };
}
