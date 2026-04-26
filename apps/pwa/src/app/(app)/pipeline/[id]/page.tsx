"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ExternalLink, RefreshCw, Check, Shuffle, Send, Ban, AlertTriangle,
  Sparkles, Eye, RotateCw,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../../lib/api";
import { SkeletonLine } from "../../../../components/skeleton";

type Res = {
  prospect: any;
  campaign: any;
  deployments: any[];
};

export default function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["pipeline", id],
    queryFn: () => api<Res>(`/api/pipeline/${id}`),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });

  const [inviteText, setInviteText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [draftingEmail, setDraftingEmail] = useState(false);
  const [instruction, setInstruction] = useState<string>("");
  const [instructionLoaded, setInstructionLoaded] = useState(false);

  async function draftInvite() {
    if (!data?.prospect?.linkedinUrl) return;
    setDrafting(true);
    try {
      const r = await api<{ body: string }>(`/api/pipeline/${id}/draft-invite`, { method: "POST", body: {} });
      setInviteText(r.body);
    } catch (e: any) {
      toast.error(e.message ?? "Draft failed");
    } finally {
      setDrafting(false);
    }
  }

  async function draftEmail() {
    if (!data?.prospect?.email) return;
    setDraftingEmail(true);
    try {
      const r = await api<{ subject: string; body: string }>(`/api/pipeline/${id}/draft-email`, { method: "POST", body: {} });
      setEmailSubject(r.subject);
      setEmailBody(r.body);
    } catch (e: any) {
      toast.error(e.message ?? "Email draft failed");
    } finally {
      setDraftingEmail(false);
    }
  }

  useEffect(() => {
    const channel = data?.campaign?.outreachChannel ?? "linkedin";
    if (data?.prospect?.state === "REDESIGNED" && data?.prospect?.linkedinUrl && (channel === "linkedin" || channel === "both") && !inviteText) {
      draftInvite();
    }
    if (data?.prospect?.state === "REDESIGNED" && data?.prospect?.email && (channel === "email" || channel === "both") && !emailBody) {
      draftEmail();
    }
  }, [data?.prospect?.state, data?.campaign?.outreachChannel]);

  useEffect(() => {
    // Sync the local textarea with the persisted instruction once on load.
    if (!instructionLoaded && data?.prospect) {
      setInstruction(data.prospect.redesignInstruction ?? "");
      setInstructionLoaded(true);
    }
  }, [data?.prospect, instructionLoaded]);

  const approve = useMutation({
    mutationFn: (sendNow: boolean) =>
      api(`/api/pipeline/${id}/approve`, {
        method: "POST",
        body: {
          approvedMessage: inviteText,
          approvedEmailSubject: emailSubject,
          approvedEmailBody: emailBody,
          sendNow,
        },
      }),
    onSuccess: (_: any, sendNow) => {
      toast.success(sendNow ? "Invite sent" : "Approved");
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const regen = useMutation({
    mutationFn: (withInstruction: boolean) =>
      api(`/api/pipeline/${id}/regenerate`, {
        method: "POST",
        body: withInstruction ? { instruction: instruction.trim() || null } : {},
      }),
    onSuccess: () => {
      toast.success("Regenerated");
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? "Regenerate failed"),
  });

  const saveInstruction = useMutation({
    mutationFn: () =>
      api(`/api/pipeline/${id}/instruction`, {
        method: "POST",
        body: { instruction: instruction.trim() || null },
      }),
    onSuccess: () => {
      toast.success("Instruction saved");
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const reject = useMutation({
    mutationFn: () => api(`/api/pipeline/${id}/reject`, { method: "POST", body: { reason: "operator_rejected" } }),
    onSuccess: () => {
      toast.success("Rejected");
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      router.replace("/pipeline");
    },
  });

  const retry = useMutation({
    mutationFn: () => api(`/api/pipeline/${id}/retry`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast.success("Queued for retry — will re-enrich on next cycle");
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? "Retry failed"),
  });

  if (isLoading || !data) {
    return (
      <div className="max-w-xl mx-auto px-4 safe-top pb-4">
        <header className="flex items-center justify-between py-3">
          <Link href="/pipeline" className="flex items-center gap-1 text-muted text-sm">
            <ArrowLeft className="w-4 h-4" /> Pipeline
          </Link>
        </header>
        <div className="space-y-4">
          <div className="card p-4 space-y-2">
            <SkeletonLine className="h-5 w-1/3" />
            <SkeletonLine className="h-7 w-2/3" />
            <SkeletonLine className="h-3 w-1/2" />
          </div>
          <div className="card p-4 space-y-2">
            <SkeletonLine className="h-4 w-1/3" />
            <SkeletonLine className="aspect-[4/3] rounded-xl" />
          </div>
          <div className="card p-4 space-y-2">
            <SkeletonLine className="h-4 w-1/4" />
            <SkeletonLine className="h-3 w-full" />
            <SkeletonLine className="h-3 w-3/4" />
          </div>
        </div>
      </div>
    );
  }
  const p = data.prospect;
  const isReviewable = p.state === "REDESIGNED" || p.state === "APPROVED_TO_SEND";
  const isRejected = p.state === "REJECTED";
  const outreachChannel = data.campaign?.outreachChannel ?? "linkedin";
  const wantsLinkedIn = outreachChannel === "linkedin" || outreachChannel === "both";
  const wantsEmail = outreachChannel === "email" || outreachChannel === "both";
  const canSendLinkedIn = !wantsLinkedIn || Boolean(p.linkedinUrl && inviteText.trim());
  const canSendEmail = !wantsEmail || Boolean(p.email && emailSubject.trim() && emailBody.trim());
  const hasAnySendTarget = Boolean((wantsLinkedIn && p.linkedinUrl) || (wantsEmail && p.email));

  return (
    <div className="max-w-xl mx-auto px-4 safe-top pb-4">
      <header className="flex items-center justify-between py-3">
        <Link href="/pipeline" className="flex items-center gap-1 text-muted text-sm">
          <ArrowLeft className="w-4 h-4" /> Pipeline
        </Link>
        <button onClick={() => refetch()} className="p-2 rounded-xl bg-surface border border-border">
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      <div className="space-y-4">
        <div className="card p-4 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="pill border border-border text-fg bg-surface2 capitalize">
              {p.state.toLowerCase().replace(/_/g, " ")}
            </span>
            {p.variantPalette && (
              <span className="pill border border-border text-muted bg-surface2">{p.variantPalette}</span>
            )}
            {p.variantLayout && (
              <span className="pill border border-border text-muted bg-surface2">{p.variantLayout}</span>
            )}
          </div>
          <h1 className="font-serif text-xl mt-2">{p.businessName}</h1>
          <p className="text-xs text-muted">
            {p.niche}
            {p.city ? ` · ${p.city}` : ""}
          </p>
          {p.website && (
            <a
              href={p.website}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg mt-1"
            >
              {p.website} <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {isRejected && (
          <div className="card p-4 border-danger/40 bg-danger/5 space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-danger">
                <AlertTriangle className="w-4 h-4" />
                <p className="text-sm font-medium">Rejected</p>
              </div>
              <p className="text-sm text-fg/80">{p.rejectionReason ?? "(no reason recorded)"}</p>
              {p.qualificationReasoning && (
                <p className="text-xs text-muted mt-1">{p.qualificationReasoning}</p>
              )}
            </div>
            <button
              onClick={() => retry.mutate()}
              disabled={retry.isPending}
              className="btn-secondary w-full"
            >
              <RotateCw className={`w-4 h-4 ${retry.isPending ? "animate-spin" : ""}`} />
              {retry.isPending ? "Queueing…" : "Retry — reset to NEW"}
            </button>
            <p className="text-[11px] text-muted">
              Resets state to NEW. Next run-cycle will re-enrich, qualify, and redesign from scratch — useful after fixing an integration (e.g. Hunter, Firecrawl).
            </p>
          </div>
        )}

        {p.redesignHtmlUrl && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <p className="text-sm font-medium">Redesign preview</p>
              </div>
              <a
                href={p.redesignHtmlUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary text-xs"
              >
                <Eye className="w-3.5 h-3.5" /> Open
              </a>
            </div>
            <iframe
              src={p.redesignHtmlUrl}
              className="w-full h-[420px] bg-white"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation-by-user-activation"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        )}

        {p.qualificationIssues?.length > 0 && (
          <div className="card p-4 space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted">Top issues identified</p>
            <ul className="text-sm space-y-1">
              {p.qualificationIssues.map((issue: string, i: number) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-accent">·</span> <span>{issue}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isReviewable && (
          <>
            <div className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-muted">
                  LinkedIn invite note {wantsLinkedIn ? "" : "(not used)"}
                </p>
                <button onClick={draftInvite} disabled={drafting || !p.linkedinUrl || !wantsLinkedIn} className="text-xs text-accent disabled:opacity-40">
                  {drafting ? "Drafting…" : "Regenerate note"}
                </button>
              </div>
              <textarea
                rows={5}
                value={inviteText}
                maxLength={299}
                onChange={(e) => setInviteText(e.target.value)}
                className="input resize-none"
                disabled={!wantsLinkedIn}
                placeholder={
                  !p.linkedinUrl
                    ? "No LinkedIn URL found"
                    : drafting
                      ? "Drafting…"
                      : "Your invite note — max 300 chars"
                }
              />
              <p className="text-[11px] text-muted text-right">{inviteText.length}/299</p>
            </div>

            <div className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-muted">
                  Instantly email {wantsEmail ? "" : "(not used)"}
                </p>
                <button onClick={draftEmail} disabled={draftingEmail || !p.email || !wantsEmail} className="text-xs text-accent disabled:opacity-40">
                  {draftingEmail ? "Drafting…" : "Regenerate email"}
                </button>
              </div>
              <input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                disabled={!wantsEmail}
                className="input text-sm"
                placeholder={!p.email ? "No email found" : "Subject"}
              />
              <textarea
                rows={6}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                disabled={!wantsEmail}
                className="input resize-none text-sm"
                placeholder={!p.email ? "No email found" : "Email body"}
              />
              <p className="text-[11px] text-muted leading-snug">
                Channel: {outreachChannel}. Email sends by adding this prospect to the configured Instantly campaign.
              </p>
            </div>

            <div className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-muted">
                  Tell the designer what to change
                </p>
                {p.redesignInstruction && instruction === (p.redesignInstruction ?? "") && (
                  <span className="text-[10px] text-accent">saved</span>
                )}
              </div>
              <textarea
                rows={3}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                className="input resize-none text-sm"
                placeholder='e.g. "make it darker, more brutalist, drop the testimonials" or "use editorial layout with serif headlines"'
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => saveInstruction.mutate()}
                  disabled={saveInstruction.isPending || instruction === (p.redesignInstruction ?? "")}
                  className="btn-secondary text-xs flex-1"
                >
                  {saveInstruction.isPending ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => regen.mutate(true)}
                  disabled={regen.isPending}
                  className="btn-primary text-xs flex-1"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {regen.isPending ? "Regenerating…" : "Apply & regenerate"}
                </button>
              </div>
              <p className="text-[11px] text-muted leading-snug">
                Free-text instruction. Persists until you clear it. Overrides the default
                creative direction on every regenerate.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => regen.mutate(false)}
                disabled={regen.isPending}
                className="btn-secondary"
              >
                <Shuffle className="w-4 h-4" /> Regen design
              </button>
              <button
                onClick={() => reject.mutate()}
                className="btn-danger"
              >
                <Ban className="w-4 h-4" /> Reject
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => approve.mutate(true)}
                disabled={approve.isPending || !hasAnySendTarget || !canSendLinkedIn || !canSendEmail}
                className="btn-primary"
              >
                <Send className="w-4 h-4" /> {approve.isPending ? "Sending…" : "Send outreach now"}
              </button>
              <button
                onClick={() => approve.mutate(false)}
                disabled={approve.isPending}
                className="btn-secondary"
              >
                <Check className="w-4 h-4" /> Approve (send on next window)
              </button>
            </div>

            {wantsLinkedIn && !p.linkedinUrl && (
              <p className="text-xs text-danger">Missing LinkedIn URL — LinkedIn send will be skipped.</p>
            )}
            {wantsEmail && !p.email && (
              <p className="text-xs text-danger">Missing email — Instantly send will be skipped.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
