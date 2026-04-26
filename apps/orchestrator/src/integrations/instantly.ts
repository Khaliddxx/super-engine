import { env } from "../lib/env.js";

const BASE_URL = "https://api.instantly.ai/api/v2";

export interface InstantlyLeadInput {
  campaignId: string;
  email: string;
  businessName: string;
  website: string | null;
  phone: string | null;
  subject: string;
  body: string;
  redesignUrl: string | null;
  topIssue: string | null;
}

export interface InstantlyLeadResult {
  id: string;
}

async function instantlyFetch<T>(path: string, init: RequestInit): Promise<T> {
  const key = env().INSTANTLY_API_KEY;
  if (!key) throw new Error("Instantly API key not configured");

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instantly API failed: ${res.status} ${text.slice(0, 500)}`);
  }

  return (await res.json()) as T;
}

/**
 * Adds the prospect as a lead to the configured Instantly campaign.
 *
 * Instantly v2 does not expose a safe "send arbitrary cold email now" endpoint.
 * The production path is: campaign contains the sending accounts and sequence,
 * we create a lead with custom variables, and Instantly sends according to the
 * campaign rules. Configure the campaign template to use:
 *   {{se_subject}}, {{se_body}}, {{redesign_url}}, {{top_issue}}
 */
export async function createInstantlyLead(input: InstantlyLeadInput): Promise<InstantlyLeadResult> {
  const json = await instantlyFetch<{ id: string }>("/leads", {
    method: "POST",
    body: JSON.stringify({
      campaign: input.campaignId,
      email: input.email,
      company_name: input.businessName,
      website: input.website,
      phone: input.phone,
      personalization: input.body,
      skip_if_in_workspace: true,
      skip_if_in_campaign: true,
      custom_variables: {
        se_subject: input.subject,
        se_body: input.body,
        redesign_url: input.redesignUrl ?? "",
        top_issue: input.topIssue ?? "",
      },
    }),
  });

  return { id: json.id };
}

export async function checkInstantlyConfigured(): Promise<{ ok: boolean; detail: string }> {
  const cfg = env();
  if (!cfg.INSTANTLY_API_KEY) return { ok: false, detail: "missing API key" };
  if (!cfg.INSTANTLY_CAMPAIGN_ID) return { ok: false, detail: "missing INSTANTLY_CAMPAIGN_ID" };

  try {
    const campaign = await instantlyFetch<{ id: string; name?: string; status?: unknown }>(`/campaigns/${cfg.INSTANTLY_CAMPAIGN_ID}`, {
      method: "GET",
    });
    return { ok: true, detail: `campaign=${campaign.name ?? campaign.id}` };
  } catch (err) {
    return { ok: false, detail: String(err).slice(0, 240) };
  }
}
