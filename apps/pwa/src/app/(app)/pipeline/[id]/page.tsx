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
  });

  const [inviteText, setInviteText] = useState("");
  const [drafting, setDrafting] = useState(false);

  async function draftInvite() {
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

  useEffect(() => {
    if (data?.prospect?.state === "REDESIGNED" && !inviteText) {
      draftInvite();
    }
     
  }, [data?.prospect?.state]);

  const approve = useMutation({
    mutationFn: (sendNow: boolean) =>
      api(`/api/pipeline/${id}/approve`, {
        method: "POST",
        body: { approvedMessage: inviteText, sendNow },
      }),
    onSuccess: (_: any, sendNow) => {
      toast.success(sendNow ? "Invite sent" : "Approved");
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const regen = useMutation({
    mutationFn: () => api(`/api/pipeline/${id}/regenerate`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast.success("Regenerated");
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? "Regenerate failed"),
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

  if (isLoading || !data) return <div className="p-6 text-muted text-sm">Loading…</div>;
  const p = data.prospect;
  const isReviewable = p.state === "REDESIGNED" || p.state === "APPROVED_TO_SEND";
  const isRejected = p.state === "REJECTED";

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
              className="w-full h-72 bg-white"
              sandbox="allow-same-origin"
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
                <p className="text-xs uppercase tracking-wider text-muted">LinkedIn invite note</p>
                <button onClick={draftInvite} disabled={drafting} className="text-xs text-accent">
                  {drafting ? "Drafting…" : "Regenerate note"}
                </button>
              </div>
              <textarea
                rows={5}
                value={inviteText}
                maxLength={299}
                onChange={(e) => setInviteText(e.target.value)}
                className="input resize-none"
                placeholder={drafting ? "Drafting…" : "Your invite note — max 300 chars"}
              />
              <p className="text-[11px] text-muted text-right">{inviteText.length}/299</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => regen.mutate()}
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
                disabled={approve.isPending || !inviteText.trim() || !p.linkedinUrl}
                className="btn-primary"
              >
                <Send className="w-4 h-4" /> {approve.isPending ? "Sending…" : "Send invite now"}
              </button>
              <button
                onClick={() => approve.mutate(false)}
                disabled={approve.isPending}
                className="btn-secondary"
              >
                <Check className="w-4 h-4" /> Approve (send on next window)
              </button>
            </div>

            {!p.linkedinUrl && (
              <p className="text-xs text-danger">Missing LinkedIn URL — can't send invite yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
