export interface LinkedInInviteInput {
  business_name: string;
  niche: string;
  city: string;
  top_issues: string[];
  redesign_url: string;
  operator_first_name: string;
}

export const LINKEDIN_INVITE_PROMPT_V1 = {
  version: "1.0",
  deployedAt: "2026-04-26",
  render: (i: LinkedInInviteInput) => `Write a LinkedIn connection request note from a web designer to the owner/manager of a local business.

The note MUST be under 300 characters (LinkedIn's hard limit). Aim for 220-280.

<prospect>
Business: ${i.business_name}
Niche: ${i.niche}
City: ${i.city}
Top issues with their current site: ${i.top_issues.join("; ")}
</prospect>

<redesign>
A live preview exists at: ${i.redesign_url}
(Don't include the URL in this connection note — that's saved for after they accept.)
</redesign>

Requirements:
- Reference one specific issue from top_issues (not a generic complaint)
- Mention you built a redesigned preview (without linking — tease it)
- Warm, respectful, direct. Not salesy.
- No "I hope this finds you well", no "dear", no corporate openers
- Sign off with "— ${i.operator_first_name}"
- Return JSON ONLY: { "body": "..." }`,
};

export interface FirstDmInput {
  business_name: string;
  niche: string;
  city: string;
  top_issues: string[];
  redesign_url: string;
  operator_first_name: string;
}

export const FIRST_DM_PROMPT_V1 = {
  version: "1.0",
  deployedAt: "2026-04-26",
  render: (i: FirstDmInput) => `The prospect just accepted your LinkedIn connection request. Write a first DM that shares the redesign preview link.

<prospect>
Business: ${i.business_name}
Niche: ${i.niche}
City: ${i.city}
Top issues with their current site: ${i.top_issues.join("; ")}
</prospect>

<redesign>
Live preview: ${i.redesign_url}
</redesign>

Requirements:
- Under 110 words. Conversational, not formal.
- Thank them briefly for accepting
- Reference one specific issue from top_issues
- Include the preview link exactly once with clear context
- Invite a low-pressure response (e.g., "even if it's just to say 'not for us', I'd value the feedback")
- No P.S., no "I hope this finds you well"
- Sign off with just "— ${i.operator_first_name}"
- Return JSON ONLY: { "body": "..." }`,
};

export interface EmailInitialInput {
  business_name: string;
  city: string;
  top_issues: string[];
  redesign_url: string;
  operator_first_name: string;
}

export const EMAIL_INITIAL_PROMPT_V1 = {
  version: "1.0",
  deployedAt: "2026-04-26",
  render: (i: EmailInitialInput) => `Write a cold email from a web design service to a local business owner.
The email introduces a specific redesigned preview of their homepage.
Tone: warm, direct, respectful of their time. Not salesy. No jargon.

<prospect>
Business: ${i.business_name}
Recipient role: Owner / Manager
Their city: ${i.city}
Top issues with their current site: ${i.top_issues.join("; ")}
</prospect>

<redesign>
Live preview: ${i.redesign_url}
</redesign>

Requirements:
- Subject line under 50 chars
- Body under 120 words
- Reference one specific issue from top_issues (not a generic complaint)
- Include the preview link exactly once, with clear context
- No P.S.
- No "I hope this finds you well"
- Sign off with just "— ${i.operator_first_name}"

Return JSON ONLY: { "subject": "...", "body": "..." }`,
};
