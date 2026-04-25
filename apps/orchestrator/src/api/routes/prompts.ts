import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { DbClient } from "@super-engine/db";
import { requireAuth } from "../auth-guard.js";
import {
  QUALIFY_PROMPT_V1,
  REDESIGN_PROMPT_V1,
  TEMPLATE_PROMPT_V1,
  LINKEDIN_INVITE_PROMPT_V1,
  FIRST_DM_PROMPT_V1,
  EMAIL_INITIAL_PROMPT_V1,
  TRIAGE_PROMPT_V1,
} from "@super-engine/prompts";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function promptRoutes(app: FastifyInstance, _opts: Opts): Promise<void> {
  app.addHook("onRequest", requireAuth);

  app.get("/", async () => {
    const demoArgs = {
      qualify: {
        name: "(example business)",
        niche: "(example niche)",
        city: "(example city)",
        rating: 4.3,
        review_count: 120,
        detected_year: 2014,
      },
      invite: {
        business_name: "(example)",
        niche: "(niche)",
        city: "(city)",
        top_issues: ["(issue 1)", "(issue 2)"],
        redesign_url: "https://preview.example",
        operator_first_name: "(you)",
      },
    };
    return {
      items: [
        { id: "qualify", version: QUALIFY_PROMPT_V1.version, preview: QUALIFY_PROMPT_V1.render(demoArgs.qualify) },
        { id: "template", version: TEMPLATE_PROMPT_V1.version, preview: TEMPLATE_PROMPT_V1.render({ niche_name: "(niche)" }) },
        { id: "redesign", version: REDESIGN_PROMPT_V1.version, preview: "(Long — not shown here.)" },
        { id: "invite", version: LINKEDIN_INVITE_PROMPT_V1.version, preview: LINKEDIN_INVITE_PROMPT_V1.render(demoArgs.invite) },
        { id: "first_dm", version: FIRST_DM_PROMPT_V1.version, preview: FIRST_DM_PROMPT_V1.render(demoArgs.invite) },
        { id: "email_initial", version: EMAIL_INITIAL_PROMPT_V1.version, preview: "(Deferred — email not sending.)" },
        { id: "triage", version: TRIAGE_PROMPT_V1.version, preview: "(Long — see spec §9.4.)" },
      ],
    };
  });
}
