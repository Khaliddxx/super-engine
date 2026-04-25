import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export interface DeployResult {
  deploymentId: string;
  url: string; // the aliased URL
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
 * Explicitly disable Vercel SSO / password protection on a project.
 * Previews must be publicly accessible — the whole point of the redesign
 * is that the prospect can click a link and see it.
 *
 * Per Vercel API: PATCH /v9/projects/{projectId} with { ssoProtection: null,
 * passwordProtection: null, deploymentProtection: null }.
 */
async function disableProjectProtection(projectId: string): Promise<void> {
  const cfg = env();
  const teamId = cfg.VERCEL_TEAM_ID;
  const qs = teamId ? `?teamId=${teamId}` : "";
  try {
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}${qs}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${cfg.VERCEL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ssoProtection: null,
        passwordProtection: null,
        // Some API revs expose this as "deploymentProtection"; send both for safety.
        deploymentProtection: null,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.warn({ projectId, status: res.status, text: text.slice(0, 300) }, "vercel disable protection failed");
    }
  } catch (err) {
    logger.warn({ projectId, err: String(err) }, "vercel disable protection threw");
  }
}

export async function deployStaticHtml(args: {
  html: string;
  businessName: string;
  prospectId: string;
}): Promise<DeployResult> {
  const teamId = env().VERCEL_TEAM_ID;
  const qs = teamId ? `?teamId=${teamId}` : "";
  const name = `${slugify(args.businessName)}-${shortHash(args.prospectId)}`;

  const files = [
    { file: "index.html", data: Buffer.from(args.html).toString("base64"), encoding: "base64" as const },
  ];

  const res = await fetch(`https://api.vercel.com/v13/deployments${qs}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env().VERCEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      files,
      target: "production",
      projectSettings: { framework: null },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel deploy failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { id: string; url: string; alias?: string[]; projectId?: string };
  const url = json.alias?.[0] ?? json.url;

  // Fire-and-forget: make the project publicly viewable.
  if (json.projectId) {
    void disableProjectProtection(json.projectId);
  }

  return { deploymentId: json.id, url: `https://${url}` };
}
