import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { eq, type DbClient, operatorSettings } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import { env } from "../../lib/env.js";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function settingsRoutes(app: FastifyInstance, opts: Opts): Promise<void> {
  app.addHook("onRequest", requireAuth);

  app.get("/", async () => {
    const cfg = env();
    const db = opts.db();
    const [s] = await db
      .select()
      .from(operatorSettings)
      .where(eq(operatorSettings.operatorEmail, cfg.OPERATOR_EMAIL || "operator@local"));
    const linkedinDailyCap = s?.linkedinDailyCap ?? cfg.LINKEDIN_DAILY_CAP;
    return {
      operator: {
        name: cfg.OPERATOR_NAME,
        email: cfg.OPERATOR_EMAIL,
        phone: cfg.OPERATOR_PHONE,
      },
      linkedinDailyCap,
      claudeModel: cfg.CLAUDE_MODEL,
      unipileConfigured: Boolean(cfg.UNIPILE_ACCOUNT_ID && cfg.UNIPILE_API_KEY && cfg.UNIPILE_DSN),
      slackConfigured: Boolean(cfg.SLACK_WEBHOOK_URL),
    };
  });

  app.get("/diagnostics", async () => {
    const cfg = env();
    const checks: Array<{ service: string; ok: boolean; detail: string }> = [];

    // Hunter
    try {
      const r = await fetch(`https://api.hunter.io/v2/account?api_key=${cfg.HUNTER_API_KEY}`);
      const j: any = await r.json();
      if (r.ok && j?.data) {
        const d = j.data;
        checks.push({
          service: "hunter",
          ok: true,
          detail: `plan=${d.plan_name ?? "?"} used=${d.requests?.searches?.used ?? "?"}/${d.requests?.searches?.available ?? "?"}`,
        });
      } else {
        checks.push({
          service: "hunter",
          ok: false,
          detail: j?.errors?.[0]?.details ?? `http ${r.status}`,
        });
      }
    } catch (e) {
      checks.push({ service: "hunter", ok: false, detail: (e as Error).message });
    }

    // Google Places
    try {
      const r = await fetch(
        `https://places.googleapis.com/v1/places:searchText?key=${cfg.GOOGLE_PLACES_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Goog-FieldMask": "places.id" },
          body: JSON.stringify({ textQuery: "coffee shop in London", pageSize: 1 }),
        },
      );
      const j: any = await r.json();
      if (r.ok) checks.push({ service: "google_places", ok: true, detail: "ok" });
      else checks.push({ service: "google_places", ok: false, detail: j?.error?.message ?? `http ${r.status}` });
    } catch (e) {
      checks.push({ service: "google_places", ok: false, detail: (e as Error).message });
    }

    // Firecrawl
    try {
      const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.FIRECRAWL_API_KEY}` },
        body: JSON.stringify({ url: "https://example.com", formats: ["markdown"], timeout: 8000 }),
      });
      if (r.ok) checks.push({ service: "firecrawl", ok: true, detail: "ok" });
      else {
        const j: any = await r.json().catch(() => ({}));
        checks.push({ service: "firecrawl", ok: false, detail: j?.error ?? `http ${r.status}` });
      }
    } catch (e) {
      checks.push({ service: "firecrawl", ok: false, detail: (e as Error).message });
    }

    // Anthropic
    checks.push({
      service: "anthropic",
      ok: Boolean(cfg.ANTHROPIC_API_KEY && cfg.ANTHROPIC_API_KEY.startsWith("sk-ant-")),
      detail: cfg.ANTHROPIC_API_KEY ? "key present" : "missing",
    });

    // Unipile
    checks.push({
      service: "unipile",
      ok: Boolean(cfg.UNIPILE_ACCOUNT_ID && cfg.UNIPILE_API_KEY && cfg.UNIPILE_DSN),
      detail: cfg.UNIPILE_ACCOUNT_ID ? "configured" : "missing",
    });

    return { checks };
  });

  app.post<{ Body: { linkedinDailyCap?: number } }>("/", async (req) => {
    const cfg = env();
    const db = opts.db();
    const key = cfg.OPERATOR_EMAIL || "operator@local";
    const [existing] = await db.select().from(operatorSettings).where(eq(operatorSettings.operatorEmail, key));
    const cap = req.body?.linkedinDailyCap;
    if (existing) {
      await db
        .update(operatorSettings)
        .set({ linkedinDailyCap: cap ?? existing.linkedinDailyCap })
        .where(eq(operatorSettings.id, existing.id));
    } else {
      await db.insert(operatorSettings).values({
        operatorEmail: key,
        linkedinDailyCap: cap ?? cfg.LINKEDIN_DAILY_CAP,
      });
    }
    return { ok: true };
  });
}
