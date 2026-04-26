"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ExternalLink, RefreshCw, Check, Shuffle, Send, Ban, AlertTriangle,
  Sparkles, Eye, RotateCw, CalendarClock, PanelRightOpen,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../../lib/api";
import { SkeletonLine } from "../../../../components/skeleton";

type EmailSendLogRow = {
  id: string;
  status: string;
  kind: string;
  externalRef: string | null;
  error: string | null;
  sentAt: string;
};

type Res = {
  prospect: any;
  campaign: any;
  deployments: any[];
  emailSendHistory?: EmailSendLogRow[];
  studioBookingUrl: string | null;
  studioBookingMailto: string | null;
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

  const outreachHydratedFor = useRef<string | null>(null);
  const canAutosaveOutreach = useRef(false);
  const emailAutoDraftTried = useRef(false);
  const linkedInAutoDraftTried = useRef(false);

  useEffect(() => {
    outreachHydratedFor.current = null;
    canAutosaveOutreach.current = false;
    emailAutoDraftTried.current = false;
    linkedInAutoDraftTried.current = false;
  }, [id]);

  useEffect(() => {
    if (!data?.prospect || data.prospect.id !== id) return;
    if (outreachHydratedFor.current === id) return;
    outreachHydratedFor.current = id;
    setEmailSubject(data.prospect.draftEmailSubject ?? "");
    setEmailBody(data.prospect.draftEmailBody ?? "");
    setInviteText(data.prospect.draftLinkedinInvite ?? "");
    queueMicrotask(() => {
      canAutosaveOutreach.current = true;
    });
  }, [data?.prospect, id]);

  const saveOutreachDrafts = useMutation({
    mutationFn: (body: {
      draftLinkedinInvite?: string | null;
      draftEmailSubject?: string | null;
      draftEmailBody?: string | null;
    }) => api(`/api/pipeline/${id}/outreach-drafts`, { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline", id] }),
  });

  useEffect(() => {
    if (!canAutosaveOutreach.current || !data?.prospect || data.prospect.id !== id) return;
    const pr = data.prospect;
    if (
      emailSubject === (pr.draftEmailSubject ?? "") &&
      emailBody === (pr.draftEmailBody ?? "") &&
      inviteText === (pr.draftLinkedinInvite ?? "")
    ) {
      return;
    }
    const t = setTimeout(() => {
      saveOutreachDrafts.mutate({
        draftEmailSubject: emailSubject,
        draftEmailBody: emailBody,
        draftLinkedinInvite: inviteText,
      });
    }, 1600);
    return () => clearTimeout(t);
  }, [emailSubject, emailBody, inviteText, id, data?.prospect]);

  const draftInvite = useCallback(async () => {
    if (!data?.prospect?.linkedinUrl) return;
    setDrafting(true);
    try {
      const r = await api<{ body: string }>(`/api/pipeline/${id}/draft-invite`, { method: "POST", body: {} });
      setInviteText(r.body);
      qc.invalidateQueries({ queryKey: ["pipeline", id] });
    } catch (e: any) {
      toast.error(e.message ?? "Draft failed");
    } finally {
      setDrafting(false);
    }
  }, [data?.prospect?.linkedinUrl, id, qc]);

  const draftEmail = useCallback(async () => {
    if (!data?.prospect?.email) return;
    setDraftingEmail(true);
    try {
      const r = await api<{ subject: string; body: string }>(`/api/pipeline/${id}/draft-email`, { method: "POST", body: {} });
      setEmailSubject(r.subject);
      setEmailBody(r.body);
      qc.invalidateQueries({ queryKey: ["pipeline", id] });
    } catch (e: any) {
      toast.error(e.message ?? "Email draft failed");
    } finally {
      setDraftingEmail(false);
    }
  }, [data?.prospect?.email, id, qc]);

  useEffect(() => {
    const channel = data?.campaign?.outreachChannel ?? "both";
    if (linkedInAutoDraftTried.current) return;
    if (data?.prospect?.state !== "REDESIGNED") return;
    if (!data?.prospect?.linkedinUrl || (channel !== "linkedin" && channel !== "both")) return;
    if (data.prospect.draftLinkedinInvite) return;
    linkedInAutoDraftTried.current = true;
    void draftInvite();
  }, [
    data?.prospect?.id,
    data?.prospect?.state,
    data?.prospect?.draftLinkedinInvite,
    data?.prospect?.linkedinUrl,
    data?.campaign?.outreachChannel,
    draftInvite,
  ]);

  useEffect(() => {
    const channel = data?.campaign?.outreachChannel ?? "both";
    const emailStates = ["ENRICHED", "REDESIGNED", "APPROVED_TO_SEND"];
    if (emailAutoDraftTried.current) return;
    if (!data?.prospect?.email || !emailStates.includes(data.prospect.state)) return;
    if (channel !== "email" && channel !== "both") return;
    if (data.prospect.draftEmailSubject || data.prospect.draftEmailBody) return;
    emailAutoDraftTried.current = true;
    void draftEmail();
  }, [
    data?.prospect?.id,
    data?.prospect?.state,
    data?.prospect?.email,
    data?.prospect?.draftEmailSubject,
    data?.prospect?.draftEmailBody,
    data?.campaign?.outreachChannel,
    draftEmail,
  ]);

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

  const retryEnrich = useMutation({
    mutationFn: () => api(`/api/pipeline/${id}/retry-enrich`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast.success("Enrich re-run");
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? "Retry failed"),
  });

  const retryRedesign = useMutation({
    mutationFn: () => api(`/api/pipeline/${id}/retry-redesign`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast.success("Redesign re-run");
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? "Retry failed"),
  });

  const sendEmailNow = useMutation({
    mutationFn: () =>
      api<{
        ok: boolean;
        send: { sent?: boolean; reason?: string; externalRef?: string };
        instantlyLeadId: string | null;
        instantlyHint?: string;
      }>(`/api/pipeline/${id}/send-email-now`, {
        method: "POST",
        body: { subject: emailSubject.trim() || undefined, body: emailBody.trim() || undefined },
      }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(`Not queued: ${r.send?.reason ?? "unknown"} — check send window, daily cap, and Instantly campaign ID.`);
        qc.invalidateQueries({ queryKey: ["pipeline", id] });
        refetch();
        return;
      }
      const lead = r.instantlyLeadId ?? r.send?.externalRef;
      toast.success(
        lead
          ? `Lead created in Instantly (${lead.slice(0, 8)}…). Delivery follows your campaign steps there — not instant from this app.`
          : "Lead submitted to Instantly",
      );
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? "Send failed"),
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
  const isRedesignFailed = p.state === "REDESIGN_FAILED";
  const outreachChannel = data.campaign?.outreachChannel ?? "both";
  const wantsLinkedIn = outreachChannel === "linkedin" || outreachChannel === "both";
  const wantsEmail = outreachChannel === "email" || outreachChannel === "both";
  const canSendLinkedIn = !wantsLinkedIn || Boolean(p.linkedinUrl && inviteText.trim());
  const canSendEmail = !wantsEmail || Boolean(p.email && emailSubject.trim() && emailBody.trim());
  const hasAnySendTarget = Boolean((wantsLinkedIn && p.linkedinUrl) || (wantsEmail && p.email));
  const emailWorkflowStates = ["ENRICHED", "REDESIGNED", "APPROVED_TO_SEND", "REDESIGN_FAILED"];
  const canShowEmailWorkflow = wantsEmail && emailWorkflowStates.includes(p.state);
  const channelLabel =
    outreachChannel === "both" ? "LinkedIn + Email" : outreachChannel === "email" ? "Email only" : "LinkedIn only";
  const contactName = [p.contactFirstName, p.contactLastName].filter(Boolean).join(" ").trim();
  const showContactStrip = Boolean(contactName || p.contactTitle || p.email || p.linkedinUrl);
  const stale30m = Boolean(
    p.updatedAt && Date.now() - new Date(p.updatedAt).getTime() > 30 * 60 * 1000,
  );

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
            <span className="pill border border-border text-muted bg-surface2 text-[11px]">{channelLabel}</span>
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
          {showContactStrip && (
            <div className="mt-3 pt-3 border-t border-border space-y-2 text-sm">
              {(contactName || p.contactTitle) && (
                <p>
                  {contactName ? <span className="font-medium">{contactName}</span> : null}
                  {contactName && p.contactTitle ? <span className="text-muted"> · </span> : null}
                  {p.contactTitle ? <span className="text-muted">{p.contactTitle}</span> : null}
                </p>
              )}
              <div className="flex flex-wrap gap-2 text-xs items-center">
                {p.email && (
                  <a href={`mailto:${p.email}`} className="pill bg-surface2 border border-border hover:border-accent">
                    {p.email}
                  </a>
                )}
                {p.linkedinUrl && (
                  <a
                    href={p.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="pill bg-surface2 border border-border hover:border-accent inline-flex items-center gap-1"
                  >
                    LinkedIn <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {p.contactEmailConfidence != null && (
                  <span className="text-muted">Hunter conf. {p.contactEmailConfidence}%</span>
                )}
              </div>
            </div>
          )}
          {stale30m && p.state === "QUALIFIED" && (
            <button
              type="button"
              onClick={() => retryEnrich.mutate()}
              disabled={retryEnrich.isPending}
              className="btn-secondary w-full mt-3 text-xs"
            >
              Retry enrich (stuck 30m+)
            </button>
          )}
          {stale30m && p.state === "ENRICHED" && !p.redesignHtmlUrl && (
            <button
              type="button"
              onClick={() => retryRedesign.mutate()}
              disabled={retryRedesign.isPending}
              className="btn-secondary w-full mt-3 text-xs"
            >
              Retry redesign (stuck 30m+)
            </button>
          )}
          {isRedesignFailed && (
            <button
              type="button"
              onClick={() => retryRedesign.mutate()}
              disabled={retryRedesign.isPending}
              className="btn-secondary w-full mt-3 text-xs border-amber-500/40"
            >
              Retry redesign
            </button>
          )}
        </div>

        {isRedesignFailed && (
          <div className="card p-4 border-amber-500/40 bg-amber-500/5 space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-amber-300">
                <AlertTriangle className="w-4 h-4" />
                <p className="text-sm font-medium">Redesign did not complete</p>
              </div>
              <p className="text-sm text-fg/80">
                {p.rejectionReason ?? "No preview was saved. You can retry redesign or send email using the live site as context."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => retryRedesign.mutate()}
              disabled={retryRedesign.isPending}
              className="btn w-full border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20"
            >
              <RotateCw className={`w-4 h-4 ${retryRedesign.isPending ? "animate-spin" : ""}`} />
              {retryRedesign.isPending ? "Queueing…" : "Retry redesign"}
            </button>
          </div>
        )}

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
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <p className="text-sm font-medium">Redesign preview</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/pipeline/${id}/preview`}
                  className="btn text-xs"
                >
                  <PanelRightOpen className="w-3.5 h-3.5" /> Studio preview
                </Link>
                {(() => {
                  const bookHref = data?.studioBookingUrl ?? data?.studioBookingMailto ?? null;
                  const bookNewTab = Boolean(data?.studioBookingUrl);
                  if (!bookHref) {
                    return (
                      <span
                        className="btn-secondary text-xs opacity-50 cursor-not-allowed"
                        title="Set STUDIO_BOOKING_URL or OPERATOR_EMAIL on the orchestrator"
                      >
                        <CalendarClock className="w-3.5 h-3.5" /> Book 15-min
                      </span>
                    );
                  }
                  return (
                    <a
                      href={bookHref}
                      {...(bookNewTab ? { target: "_blank", rel: "noreferrer" } : {})}
                      className="btn-secondary text-xs"
                    >
                      <CalendarClock className="w-3.5 h-3.5" /> Book 15-min
                    </a>
                  );
                })()}
                <a
                  href={p.redesignHtmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary text-xs"
                >
                  <Eye className="w-3.5 h-3.5" /> Open site
                </a>
              </div>
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

        {canShowEmailWorkflow && (
          <div className="card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-muted">Instantly email</p>
              <button
                type="button"
                onClick={() => void draftEmail()}
                disabled={draftingEmail || !p.email}
                className="text-xs text-accent disabled:opacity-40"
              >
                {draftingEmail ? "Drafting…" : "Regenerate email"}
              </button>
            </div>
            <input
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              disabled={!p.email}
              className="input text-sm"
              placeholder={!p.email ? "No email found" : "Subject"}
            />
            <textarea
              rows={6}
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              disabled={!p.email}
              className="input resize-none text-sm"
              placeholder={!p.email ? "No email found" : "Email body"}
            />
            <button
              type="button"
              onClick={() => sendEmailNow.mutate()}
              disabled={
                sendEmailNow.isPending ||
                !p.email ||
                !emailSubject.trim() ||
                !emailBody.trim()
              }
              className="btn-primary w-full text-sm"
            >
              <Send className="w-4 h-4" />
              {sendEmailNow.isPending ? "Sending…" : "Add to Instantly campaign"}
            </button>
            <p className="text-[11px] text-muted leading-snug">
              Creates a <strong className="font-medium text-fg/80">lead</strong> in your Instantly campaign with{" "}
              <code className="text-[10px]">se_subject</code>, <code className="text-[10px]">se_body</code>, and{" "}
              <code className="text-[10px]">redesign_url</code>. Actual send time is controlled inside Instantly (sequence
              / schedule), not here. Drafts auto-save to this prospect.
            </p>
          </div>
        )}

        {Boolean(data.emailSendHistory?.length) && (
          <div className="card p-4 space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted">Email activity (this prospect)</p>
            <ul className="text-xs space-y-2 text-muted">
              {data.emailSendHistory!.map((row) => (
                <li key={row.id} className="border-b border-border/60 pb-2 last:border-0 last:pb-0">
                  <span className="text-fg/90 font-medium capitalize">{row.status}</span>
                  {row.externalRef ? (
                    <>
                      {" "}
                      · ID{" "}
                      <code className="text-[10px] text-fg/80 select-all">{row.externalRef}</code>{" "}
                      <a
                        href="https://app.instantly.ai/app/crm/leads"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent underline"
                      >
                        CRM
                      </a>
                    </>
                  ) : null}
                  {row.error ? (
                    <>
                      {" "}
                      · <span className="text-danger">{row.error}</span>
                    </>
                  ) : null}
                  <div className="text-[10px] mt-0.5 opacity-80">
                    {new Date(row.sentAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-muted">
              Replies and delivery show in Instantly (and your connected inbox), not in this pipeline UI yet.
            </p>
          </div>
        )}

        {isReviewable && (
          <>
            <div className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-muted">
                  LinkedIn invite note {wantsLinkedIn ? "" : "(not used)"}
                </p>
                <button
                  type="button"
                  onClick={() => void draftInvite()}
                  disabled={drafting || !p.linkedinUrl || !wantsLinkedIn}
                  className="text-xs text-accent disabled:opacity-40"
                >
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
