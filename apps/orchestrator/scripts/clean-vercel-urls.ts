// One-shot script: clean up existing prospect previews.
//
// 1. For every prospect with a redesignHtmlUrl, derive the project name from
//    the URL and PATCH the project to disable ssoProtection + passwordProtection
//    (Vercel hobby teams enable these by default — race-prone fire-and-forget
//    in the previous code left some prospects gated).
// 2. Rewrite the stored redesignHtmlUrl to the clean form
//    `https://<project>.vercel.app` — drops the deployment hash + team slug.
//
// We never delete or recreate anything. Run from repo root:
//   pnpm exec tsx apps/orchestrator/scripts/clean-vercel-urls.ts

import "dotenv/config";
import { createDatabase, prospects, eq, isNotNull } from "@super-engine/db";

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || "";

if (!VERCEL_TOKEN) throw new Error("VERCEL_TOKEN not set");

const TEAM_QS = VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : "";

interface ProjectSummary {
  id: string;
  name: string;
}

async function findProject(projectName: string): Promise<ProjectSummary | null> {
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${projectName}${TEAM_QS}`,
    { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    console.warn(`  lookup failed for ${projectName}: ${res.status} ${text.slice(0, 120)}`);
    return null;
  }
  const json = (await res.json()) as { id: string; name: string };
  return { id: json.id, name: json.name };
}

async function disableProtection(projectId: string): Promise<boolean> {
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${projectId}${TEAM_QS}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ssoProtection: null,
        passwordProtection: null,
      }),
    },
  );
  return res.ok;
}

function deriveProjectName(url: string): string | null {
  // URL forms we expect:
  //   https://<project>.vercel.app
  //   https://<project>-<hash>-<team>.vercel.app
  // We treat the FIRST hyphen-segment that is followed by a 9-char hash as the
  // boundary; if no team slug is detected we just use the whole subdomain.
  try {
    const u = new URL(url);
    const sub = u.hostname.replace(/\.vercel\.app$/, "");

    // If it's already clean (no team suffix), it's the project name.
    // Heuristic: a deployment URL ALWAYS has the segment "khalids-projects-<id>"
    // appended. Strip everything from that segment onward.
    const teamSlugRe = /-khalids-projects-[a-z0-9]+$/;
    if (teamSlugRe.test(sub)) {
      // Now strip the per-deploy hash too.
      // Format: <project>-<deployHash>-khalids-projects-<id>
      // We don't know the project name's hyphen count. The deploy hash is
      // always 9 lowercase alphanumeric chars BEFORE -khalids-projects.
      const stripped = sub.replace(teamSlugRe, "");
      const m = stripped.match(/^(.+)-([a-z0-9]{9})$/);
      if (m) return m[1]!;
      return stripped;
    }
    // already clean
    return sub;
  } catch {
    return null;
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const d = createDatabase(url);

  const rows = await d
    .select({
      id: prospects.id,
      businessName: prospects.businessName,
      redesignHtmlUrl: prospects.redesignHtmlUrl,
    })
    .from(prospects)
    .where(isNotNull(prospects.redesignHtmlUrl));

  console.log(`Auditing ${rows.length} prospects with redesignHtmlUrl…\n`);

  let cleaned = 0;
  let disabled = 0;
  let failed = 0;

  for (const r of rows) {
    const oldUrl = r.redesignHtmlUrl!;
    const projectName = deriveProjectName(oldUrl);
    if (!projectName) {
      console.log(`  ! ${r.businessName}: could not derive project name from ${oldUrl}`);
      failed++;
      continue;
    }

    const cleanUrl = `https://${projectName}.vercel.app`;

    // Look up the project, disable protection
    const proj = await findProject(projectName);
    if (proj) {
      const ok = await disableProtection(proj.id);
      if (ok) disabled++;
      else console.log(`  ! ${r.businessName}: disable returned non-2xx for project ${proj.name}`);
    } else {
      console.log(`  ? ${r.businessName}: project ${projectName} not found (probably deleted)`);
    }

    // Rewrite stored URL if it changed
    if (cleanUrl !== oldUrl) {
      await d
        .update(prospects)
        .set({ redesignHtmlUrl: cleanUrl, updatedAt: new Date() })
        .where(eq(prospects.id, r.id));
      console.log(`  ✓ ${r.businessName}: ${oldUrl} → ${cleanUrl}`);
      cleaned++;
    }
  }

  console.log(`\nDone. ${cleaned} URLs rewritten, ${disabled} projects unprotected, ${failed} skipped.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
