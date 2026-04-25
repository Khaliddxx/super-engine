import { env } from "../lib/env.js";

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
  // quick & simple non-cryptographic shortener
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 6);
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
  const json = (await res.json()) as { id: string; url: string; alias?: string[] };
  const url = json.alias?.[0] ?? json.url;
  return { deploymentId: json.id, url: `https://${url}` };
}
