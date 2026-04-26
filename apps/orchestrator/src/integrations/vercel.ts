import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export interface DeployResult {
  deploymentId: string;
  projectId: string | null;
  url: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function shortHash(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 6);
}

/**
 * Explicitly disable Vercel SSO / password protection on a project so the
 * preview is publicly accessible.
 *
 * Hobby teams ship with `ssoProtection: { deploymentType: "all_except_custom_domains" }`
 * by default. We MUST clear it before exposing the URL or the prospect hits a
 * Vercel auth wall.
 *
 * Retries up to 3x with exponential backoff. We always await this — racing the
 * disable against the URL we return is what caused the auth wall in the past.
 */
async function disableProjectProtection(projectId: string): Promise<boolean> {
  const cfg = env();
  const teamId = cfg.VERCEL_TEAM_ID;
  const qs = teamId ? `?teamId=${teamId}` : "";
  const url = `https://api.vercel.com/v9/projects/${projectId}${qs}`;
  // NOTE: only `ssoProtection` + `passwordProtection` are valid fields on
  // PATCH /v9/projects. Sending `deploymentProtection` returns 400.
  const body = JSON.stringify({
    ssoProtection: null,
    passwordProtection: null,
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${cfg.VERCEL_TOKEN}`,
          "Content-Type": "application/json",
        },
        body,
      });
      if (res.ok) {
        const json = (await res.json()) as { ssoProtection?: unknown; passwordProtection?: unknown };
        if (!json.ssoProtection && !json.passwordProtection) {
          return true;
        }
        logger.warn({ projectId, attempt, json }, "vercel disable: response says protection still active");
      } else {
        const text = await res.text();
        logger.warn(
          { projectId, attempt, status: res.status, text: text.slice(0, 240) },
          "vercel disable failed",
        );
      }
    } catch (err) {
      logger.warn({ projectId, attempt, err: String(err) }, "vercel disable threw");
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  return false;
}

export interface StaticSiteFile {
  /** Path within the deployment root, e.g. "index.html", "about.html". */
  file: string;
  /** File contents as UTF-8 text, or base64 when `encoding` is `"base64"` (binary assets). */
  data: string;
  encoding?: "utf8" | "base64";
}

export async function deployStaticSite(args: {
  files: StaticSiteFile[];
  businessName: string;
  prospectId: string;
  projectNameSuffix?: string;
}): Promise<DeployResult> {
  if (args.files.length === 0) throw new Error("deployStaticSite: no files provided");
  const teamId = env().VERCEL_TEAM_ID;
  const qs = teamId ? `?teamId=${teamId}` : "";
  const suffix = args.projectNameSuffix ? `-${slugify(args.projectNameSuffix).slice(0, 18)}` : "";
  const projectName = `${slugify(args.businessName)}-${shortHash(args.prospectId)}${suffix}`.slice(0, 63);

  const files = args.files.map((f) => {
    const buf =
      f.encoding === "base64" ? Buffer.from(f.data, "base64") : Buffer.from(f.data, "utf8");
    return {
      file: f.file,
      data: buf.toString("base64"),
      encoding: "base64" as const,
    };
  });

  const res = await fetch(`https://api.vercel.com/v13/deployments${qs}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env().VERCEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: projectName,
      files,
      target: "production",
      projectSettings: { framework: null },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel deploy failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    id: string;
    url: string;
    alias?: string[];
    projectId?: string;
  };

  // Synchronously make the project publicly viewable BEFORE we return the URL.
  // This eliminates the race where the operator (or prospect) hits the URL
  // before our fire-and-forget disable lands.
  const projectId = json.projectId ?? null;
  if (projectId) {
    const ok = await disableProjectProtection(projectId);
    if (!ok) {
      logger.error({ projectId, projectName }, "could not disable vercel protection — preview will hit auth wall");
    }
  }

  // Prefer the clean production alias `<project>.vercel.app` over the
  // deployment hash + team-slug URL. Both exist in `automaticAliases` /
  // `targets.production.alias`, but the cleanest is just the project name.
  // Vercel auto-resolves `https://<project>.vercel.app` to the latest
  // production deployment for that project, so this URL stays valid even on
  // re-deploys.
  const cleanUrl = `https://${projectName}.vercel.app`;

  return { deploymentId: json.id, projectId, url: cleanUrl };
}

/** @deprecated Use {@link deployStaticSite} instead. Kept for backwards-compat callers. */
export async function deployStaticHtml(args: {
  html: string;
  businessName: string;
  prospectId: string;
}): Promise<DeployResult> {
  return deployStaticSite({
    files: [{ file: "index.html", data: args.html }],
    businessName: args.businessName,
    prospectId: args.prospectId,
  });
}
