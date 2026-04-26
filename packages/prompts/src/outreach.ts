export interface LinkedInInviteInput {
  business_name: string;
  niche: string;
  city: string;
  top_issues: string[];
  redesign_url: string;
  operator_first_name: string;
}

export const LINKEDIN_INVITE_PROMPT_V1 = {
  version: "2.0",
  deployedAt: "2026-04-26",
  render: (i: LinkedInInviteInput) => `Write a LinkedIn connection-request note from one independent web designer to the owner or manager of a local business.

The note MUST be under 300 characters total (LinkedIn's hard limit). Aim for 180 to 260.

<prospect>
Business: ${i.business_name}
Niche: ${i.niche}
City where THEIR business is: ${i.city}
Issues I noticed on their site: ${i.top_issues.join("; ")}
</prospect>

<redesign>
I already built a redesigned preview at: ${i.redesign_url}
Do NOT include the URL in this note. We send the link AFTER they accept.
</redesign>

HARD RULES:
- Do NOT claim to be located in their city or any city. Do NOT use phrases like "I'm a designer in ${i.city}" or "local to you". You have no location affiliation with them.
- Do NOT use em-dashes (—) or en-dashes (–). Use commas, periods, or line breaks.
- Do NOT use "I hope this finds you well", "Dear", "Hi there", or any corporate opener.
- Do NOT flatter. Do NOT say "love what you do".
- Reference ONE specific issue from the list above (not a generic "your site could be improved").
- Mention you built a redesigned preview without linking it (tease it).
- Sign off with ONLY the first name on its own line: "${i.operator_first_name}"
  (No dash before the name. No "Best," or "Thanks,".)
- Use contractions. Sound like a human texting, not a consultant emailing.
- Write at roughly a 7th-grade reading level.

Return JSON ONLY, nothing else:
{ "body": "..." }`,
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
  version: "2.0",
  deployedAt: "2026-04-26",
  render: (i: FirstDmInput) => `The prospect just accepted your LinkedIn connection request. Write a first DM that shares the redesign preview link.

<prospect>
Business: ${i.business_name}
Niche: ${i.niche}
City where THEIR business is: ${i.city}
Issues I noticed on their site: ${i.top_issues.join("; ")}
</prospect>

<redesign>
Live preview URL (include this exactly once): ${i.redesign_url}
</redesign>

HARD RULES:
- Under 110 words.
- Do NOT claim to be in their city or any city. No "fellow local", no "based in ${i.city}".
- Do NOT use em-dashes (—) or en-dashes (–). Use commas or periods.
- Thank them briefly for connecting (one short sentence).
- Reference ONE specific issue from the list above, concretely.
- Present the preview link with a short contextual sentence. Example phrasing: "Mocked something up so you can see what I mean: <url>".
- Invite a low-pressure response. A line like "Even a quick 'not for us' is useful feedback" is good.
- No P.S.
- No "I hope this finds you well".
- Sign off with ONLY the first name on its own line: "${i.operator_first_name}"
  (No dash. No "Cheers," or "Best,".)
- Conversational. Contractions. Short sentences.

Return JSON ONLY, nothing else:
{ "body": "..." }`,
};

export interface EmailInitialInput {
  business_name: string;
  city: string;
  top_issues: string[];
  /** Live redesign preview when available */
  redesign_url: string;
  /** Fallback link (their website) when no preview yet */
  website_url: string;
  operator_first_name: string;
}

export const EMAIL_INITIAL_PROMPT_V1 = {
  version: "2.0",
  deployedAt: "2026-04-26",
  render: (i: EmailInitialInput) => `Write a cold email from an independent web designer to the owner or manager of a local business.
The email introduces either a live redesign preview of their homepage (if a preview URL exists) or a concrete observation about their current site with a link to it.
Tone: warm, direct, respectful of their time. Not salesy. No jargon.

<prospect>
Business: ${i.business_name}
City where THEIR business is: ${i.city}
Issues I noticed on their site: ${i.top_issues.join("; ")}
</prospect>

<link_to_share>
${
  i.redesign_url?.trim()
    ? `Live redesign preview URL (include this exactly once in the email): ${i.redesign_url}`
    : `Their current website URL (include this exactly once as the link to look at): ${i.website_url || "(missing — do not invent a URL)"}`
}
</link_to_share>

HARD RULES:
- Subject line under 50 chars. No clickbait, no caps lock, no emoji.
- Body under 120 words.
- Do NOT claim to be in their city or any city. No "fellow local" language.
- Do NOT use em-dashes (—) or en-dashes (–). Use commas or periods.
- Reference ONE specific issue from the list above concretely.
- Include the link from link_to_share exactly once.
- No "I hope this finds you well".
- No P.S.
- Sign off with ONLY the first name on its own line: "${i.operator_first_name}"

Return JSON ONLY, nothing else:
{ "subject": "...", "body": "..." }`,
};
