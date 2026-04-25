import { env } from "../lib/env.js";

// Unipile uses a per-account DSN like "api41.unipile.com:17147"
function base(): string {
  const dsn = env().UNIPILE_DSN;
  if (!dsn) throw new Error("UNIPILE_DSN is not configured");
  return `https://${dsn}/api/v1`;
}

function headers(): Record<string, string> {
  const apiKey = env().UNIPILE_API_KEY ?? "";
  return {
    "X-API-KEY": apiKey,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

export interface UnipileAccount {
  id: string;
  name: string;
  type: string;
}

export async function listAccounts(): Promise<UnipileAccount[]> {
  const res = await fetch(`${base()}/accounts`, { headers: headers() });
  if (!res.ok) throw new Error(`Unipile listAccounts failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { items?: any[] };
  return (json.items ?? []).map((a) => ({ id: a.id, name: a.name ?? "", type: a.type ?? "" }));
}

export interface SendInviteResult {
  invitationId: string;
  providerId: string | null;
}

export async function sendLinkedInInvite(args: {
  accountId: string;
  linkedinUrl: string;
  message: string; // must be < 300 chars
}): Promise<SendInviteResult> {
  // Extract public identifier from linkedin URL
  const publicIdMatch = args.linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!publicIdMatch) throw new Error(`Invalid LinkedIn URL: ${args.linkedinUrl}`);
  const publicId = publicIdMatch[1]!;

  // Step 1: fetch profile to resolve provider_id
  const profileRes = await fetch(`${base()}/users/${publicId}?account_id=${args.accountId}`, { headers: headers() });
  if (!profileRes.ok) throw new Error(`Unipile lookup user failed: ${profileRes.status} ${await profileRes.text()}`);
  const profile = (await profileRes.json()) as { provider_id?: string };
  const providerId = profile.provider_id ?? null;
  if (!providerId) throw new Error("Unipile: provider_id missing from profile");

  // Step 2: send invitation
  const inviteRes = await fetch(`${base()}/users/invite`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      account_id: args.accountId,
      provider_id: providerId,
      message: args.message.slice(0, 299),
    }),
  });
  if (!inviteRes.ok) throw new Error(`Unipile send invite failed: ${inviteRes.status} ${await inviteRes.text()}`);
  const invite = (await inviteRes.json()) as { invitation_id?: string; id?: string };
  return { invitationId: invite.invitation_id ?? invite.id ?? "", providerId };
}

export interface UnipileInvitationStatus {
  invitationId: string;
  status: string; // pending | accepted | declined | withdrawn
  acceptedAt?: string | null;
}

/** Fetch sent invitations so we can detect which have been accepted. */
export async function listSentInvitations(accountId: string): Promise<UnipileInvitationStatus[]> {
  const res = await fetch(`${base()}/users/invite/sent?account_id=${accountId}`, { headers: headers() });
  if (!res.ok) {
    // Some Unipile tiers return 404 for this endpoint — fall back to the relations endpoint via chats
    return [];
  }
  const json = (await res.json()) as { items?: any[] };
  return (json.items ?? []).map((i) => ({
    invitationId: i.id ?? i.invitation_id,
    status: i.status ?? "pending",
    acceptedAt: i.accepted_at ?? null,
  }));
}

export interface UnipileChat {
  id: string;
  providerId: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  attendeeName: string | null;
}

export async function listChats(accountId: string, sinceIso?: string): Promise<UnipileChat[]> {
  const qs = new URLSearchParams({ account_id: accountId });
  if (sinceIso) qs.set("after", sinceIso);
  const res = await fetch(`${base()}/chats?${qs.toString()}`, { headers: headers() });
  if (!res.ok) throw new Error(`Unipile listChats failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { items?: any[] };
  return (json.items ?? []).map((c) => ({
    id: c.id,
    providerId: c.attendee_provider_id ?? c.provider_id ?? null,
    unreadCount: c.unread_count ?? 0,
    lastMessageAt: c.last_message_at ?? null,
    attendeeName: c.attendee_name ?? c.name ?? null,
  }));
}

export interface UnipileMessage {
  id: string;
  chatId: string;
  direction: "in" | "out";
  text: string;
  sentAt: string;
  senderName: string | null;
}

export async function listMessages(chatId: string, sinceIso?: string): Promise<UnipileMessage[]> {
  const qs = new URLSearchParams();
  if (sinceIso) qs.set("after", sinceIso);
  const res = await fetch(`${base()}/chats/${chatId}/messages?${qs.toString()}`, { headers: headers() });
  if (!res.ok) throw new Error(`Unipile listMessages failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { items?: any[] };
  return (json.items ?? []).map((m) => ({
    id: m.id,
    chatId,
    direction: m.is_sender ? "out" : "in",
    text: m.text ?? m.body ?? "",
    sentAt: m.timestamp ?? m.created_at ?? new Date().toISOString(),
    senderName: m.sender_name ?? null,
  }));
}

export async function sendChatMessage(args: { chatId: string; text: string }): Promise<{ messageId: string }> {
  const res = await fetch(`${base()}/chats/${args.chatId}/messages`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ text: args.text }),
  });
  if (!res.ok) throw new Error(`Unipile sendChatMessage failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id?: string; message_id?: string };
  return { messageId: json.id ?? json.message_id ?? "" };
}

export async function startChat(args: { accountId: string; providerId: string; text: string }): Promise<{ chatId: string; messageId: string }> {
  const res = await fetch(`${base()}/chats`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      account_id: args.accountId,
      attendees_ids: [args.providerId],
      text: args.text,
    }),
  });
  if (!res.ok) throw new Error(`Unipile startChat failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { chat_id?: string; id?: string; message_id?: string };
  return { chatId: json.chat_id ?? json.id ?? "", messageId: json.message_id ?? "" };
}
