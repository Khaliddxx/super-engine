"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import {
  Calendar, Flame, MessageSquare, AlertCircle, BellOff, RefreshCw, Check, X, Edit3,
  Sparkles, Rocket, ExternalLink, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../lib/api";

type TriageItem = {
  type: "triage";
  id: string;
  status: string;
  kind: string;
  classification: string | null;
  confidence: string | null;
  summary: string | null;
  draftResponse: string | null;
  editedResponse: string | null;
  reasoning: string | null;
  priority: string | null;
  createdAt: string;
  messageId: string;
  prospectId: string;
  businessName: string;
  niche: string;
  city: string | null;
  redesignHtmlUrl: string | null;
  linkedinUrl: string | null;
};

type ReviewItem = {
  type: "review_redesign";
  id: string;
  prospectId: string;
  status: "pending";
  createdAt: string;
  businessName: string;
  niche: string;
  city: string | null;
  website: string | null;
  screenshotUrl: string | null;
  redesignHtmlUrl: string | null;
  linkedinUrl: string | null;
  qualificationIssues: string[];
  qualificationScore: string | null;
  variantPalette: string | null;
  variantLayout: string | null;
};

type QueueItem = TriageItem | ReviewItem;

const CLASSIFICATION_META: Record<string, { label: string; icon: React.FC<any>; color: string }> = {
  booking: { label: "Booking", icon: Calendar, color: "text-green-400 bg-green-500/10 border-green-500/30" },
  hot: { label: "Hot", icon: Flame, color: "text-orange-400 bg-orange-500/10 border-orange-500/30" },
  warm: { label: "Warm", icon: MessageSquare, color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30" },
  objection: { label: "Objection", icon: AlertCircle, color: "text-amber-300 bg-amber-500/10 border-amber-500/30" },
  notnow: { label: "Not Now", icon: BellOff, color: "text-muted bg-surface2 border-border" },
  unsub: { label: "Unsub", icon: X, color: "text-red-400 bg-red-500/10 border-red-500/30" },
  human: { label: "Needs You", icon: AlertCircle, color: "text-accent bg-accent/10 border-accent/30" },
};

const KIND_META: Record<string, { label: string; icon: React.FC<any> }> = {
  first_dm_after_accept: { label: "First DM", icon: Rocket },
  reply: { label: "Reply", icon: MessageSquare },
};

export default function QueuePage() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["queue"],
    queryFn: () => api<{ items: QueueItem[] }>("/api/queue"),
    refetchInterval: 30_000,
  });

  const approveTriage = useMutation({
    mutationFn: ({ id, text }: { id: string; text?: string }) =>
      api(`/api/queue/${id}/approve`, { method: "POST", body: { text } }),
    onSuccess: () => {
      toast.success("Sent");
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Send failed"),
  });

  const rejectTriage = useMutation({
    mutationFn: (id: string) => api(`/api/queue/${id}/reject`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast.success("Dismissed");
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });

  const approveReview = useMutation({
    mutationFn: (prospectId: string) =>
      api(`/api/queue/review/${prospectId}/approve`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast.success("Redesign approved — ready to send");
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Approve failed"),
  });

  const rejectReview = useMutation({
    mutationFn: (prospectId: string) =>
      api(`/api/queue/review/${prospectId}/reject`, {
        method: "POST",
        body: { reason: "operator_review_rejected" },
      }),
    onSuccess: () => {
      toast.success("Redesign rejected");
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });

  const seedMutation = useMutation({
    mutationFn: () => api<{ created: number }>("/api/queue/seed-demo", { method: "POST", body: { count: 3 } }),
    onSuccess: (d) => {
      toast.success(`Seeded ${d.created} demo cards`);
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });

  const items = data?.items ?? [];
  const pending = items.filter((i) => i.status === "pending");
  const reviewCount = pending.filter((i) => i.type === "review_redesign").length;
  const triageCount = pending.filter((i) => i.type === "triage").length;

  return (
    <div className="max-w-xl mx-auto px-4 safe-top">
      <header className="flex items-center justify-between py-4">
        <div>
          <h1 className="text-xl font-serif">Queue</h1>
          <p className="text-xs text-muted">
            {reviewCount > 0 && <>{reviewCount} to review · </>}
            {triageCount} triage · swipe to decide
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-xl bg-surface border border-border"
          aria-label="refresh"
        >
          <RefreshCw className={`w-4 h-4 ${isRefetching ? "animate-spin" : ""}`} />
        </button>
      </header>

      {isLoading && <div className="text-muted text-sm py-10 text-center">Loading…</div>}

      {!isLoading && pending.length === 0 && (
        <div className="card p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/30 mx-auto flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h2 className="font-serif text-lg">Inbox zero</h2>
            <p className="text-sm text-muted mt-1">Nothing to triage or review right now.</p>
          </div>
          <button onClick={() => seedMutation.mutate()} className="btn-secondary mx-auto">
            Seed demo cards
          </button>
        </div>
      )}

      <div className="space-y-3 pt-1">
        {pending.map((item) =>
          item.type === "review_redesign" ? (
            <ReviewCard
              key={item.id}
              item={item}
              onApprove={() => approveReview.mutate(item.prospectId)}
              onReject={() => rejectReview.mutate(item.prospectId)}
            />
          ) : (
            <SwipeCard
              key={item.id}
              item={item}
              onApprove={() => approveTriage.mutate({ id: item.id })}
              onReject={() => rejectTriage.mutate(item.id)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function ReviewCard({
  item,
  onApprove,
  onReject,
}: {
  item: ReviewItem;
  onApprove: () => void;
  onReject: () => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-6, 0, 6]);
  const approveOpacity = useTransform(x, [0, 80, 160], [0, 0.5, 1]);
  const rejectOpacity = useTransform(x, [-160, -80, 0], [1, 0.5, 0]);

  function handleDragEnd(_: unknown, info: PanInfo) {
    const dx = info.offset.x;
    if (dx > 140) onApprove();
    else if (dx < -140) onReject();
  }

  return (
    <motion.div style={{ x, rotate }} className="relative">
      <motion.div
        style={{ opacity: rejectOpacity }}
        className="absolute inset-0 flex items-center justify-start pl-6 pointer-events-none"
      >
        <div className="flex items-center gap-2 text-danger font-semibold">
          <X className="w-6 h-6" /> Reject
        </div>
      </motion.div>
      <motion.div
        style={{ opacity: approveOpacity }}
        className="absolute inset-0 flex items-center justify-end pr-6 pointer-events-none"
      >
        <div className="flex items-center gap-2 text-success font-semibold">
          Approve <Check className="w-6 h-6" />
        </div>
      </motion.div>

      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.5}
        onDragEnd={handleDragEnd}
        whileTap={{ scale: 0.99 }}
        className="card overflow-hidden touch-pan-y"
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="pill border border-accent/30 bg-accent/10 text-accent">
                <Sparkles className="w-3 h-3" /> Review redesign
              </span>
              {item.variantLayout && (
                <span className="pill border border-border text-muted bg-surface2">{item.variantLayout}</span>
              )}
            </div>
            <h3 className="mt-2 font-medium truncate">{item.businessName}</h3>
            <p className="text-xs text-muted">
              {item.niche}
              {item.city ? ` · ${item.city}` : ""}
            </p>
          </div>
          <Link
            href={`/pipeline/${item.prospectId}`}
            className="btn-secondary px-3 py-2 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <Edit3 className="w-3.5 h-3.5" /> Open
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-2 px-4 pt-3">
          <figure className="space-y-1">
            <figcaption className="text-[10px] uppercase tracking-wider text-muted">Current</figcaption>
            <div className="aspect-[4/3] rounded-xl overflow-hidden bg-surface2 border border-border">
              {item.screenshotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.screenshotUrl}
                  alt="current site"
                  className="w-full h-full object-cover object-top"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[11px] text-muted">no screenshot</div>
              )}
            </div>
            {item.website && (
              <a
                href={item.website}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-muted hover:text-fg inline-flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                {new URL(item.website).hostname} <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </figure>

          <figure className="space-y-1">
            <figcaption className="text-[10px] uppercase tracking-wider text-accent">Redesign</figcaption>
            <div className="aspect-[4/3] rounded-xl overflow-hidden bg-white border border-accent/30">
              {item.redesignHtmlUrl ? (
                <iframe
                  src={item.redesignHtmlUrl}
                  className="w-full h-full pointer-events-none"
                  sandbox="allow-same-origin allow-scripts"
                  scrolling="no"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  style={{ transform: "scale(0.4)", transformOrigin: "top left", width: "250%", height: "250%" }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[11px] text-muted">no preview</div>
              )}
            </div>
            {item.redesignHtmlUrl && (
              <a
                href={item.redesignHtmlUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-accent hover:underline inline-flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Eye className="w-3 h-3" /> Full preview
              </a>
            )}
          </figure>
        </div>

        {item.qualificationIssues?.length > 0 && (
          <div className="px-4 pt-3">
            <p className="text-[10px] uppercase tracking-wider text-muted mb-1">Top issues AI flagged</p>
            <ul className="text-[12px] text-fg/80 space-y-0.5">
              {item.qualificationIssues.slice(0, 3).map((iss, i) => (
                <li key={i} className="flex gap-1">
                  <span className="text-accent">·</span> <span>{iss}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2 p-4 pt-3">
          <button onClick={onReject} className="btn-danger flex-1 text-xs">
            <X className="w-4 h-4" /> Reject
          </button>
          <button onClick={onApprove} className="btn-primary flex-1 text-xs">
            <Check className="w-4 h-4" /> Approve
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SwipeCard({
  item,
  onApprove,
  onReject,
}: {
  item: TriageItem;
  onApprove: () => void;
  onReject: () => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-6, 0, 6]);
  const approveOpacity = useTransform(x, [0, 80, 160], [0, 0.5, 1]);
  const rejectOpacity = useTransform(x, [-160, -80, 0], [1, 0.5, 0]);

  function handleDragEnd(_: unknown, info: PanInfo) {
    const dx = info.offset.x;
    if (dx > 140) onApprove();
    else if (dx < -140) onReject();
  }

  const classMeta = CLASSIFICATION_META[item.classification ?? "human"] ?? CLASSIFICATION_META.human!;
  const kindMeta = KIND_META[item.kind] ?? KIND_META.reply!;
  const ClassIcon = classMeta.icon;
  const KindIcon = kindMeta.icon;
  const confidence = item.confidence ? Math.round(Number(item.confidence) * 100) : null;

  return (
    <motion.div style={{ x, rotate }} className="relative">
      <motion.div
        style={{ opacity: rejectOpacity }}
        className="absolute inset-0 flex items-center justify-start pl-6 pointer-events-none"
      >
        <div className="flex items-center gap-2 text-danger font-semibold">
          <X className="w-6 h-6" /> Dismiss
        </div>
      </motion.div>
      <motion.div
        style={{ opacity: approveOpacity }}
        className="absolute inset-0 flex items-center justify-end pr-6 pointer-events-none"
      >
        <div className="flex items-center gap-2 text-success font-semibold">
          Send <Check className="w-6 h-6" />
        </div>
      </motion.div>

      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.5}
        onDragEnd={handleDragEnd}
        whileTap={{ scale: 0.98 }}
        className="card p-4 space-y-3 touch-pan-y"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`pill border ${classMeta.color}`}>
                <ClassIcon className="w-3 h-3" /> {classMeta.label}
              </span>
              <span className="pill border border-border text-muted">
                <KindIcon className="w-3 h-3" /> {kindMeta.label}
              </span>
              {confidence !== null && (
                <span className="text-[11px] text-muted">{confidence}%</span>
              )}
            </div>
            <h3 className="mt-2 font-medium truncate">{item.businessName}</h3>
            <p className="text-xs text-muted">
              {item.niche}
              {item.city ? ` · ${item.city}` : ""}
            </p>
          </div>
          <Link
            href={`/queue/${item.id}`}
            className="btn-secondary px-3 py-2 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </Link>
        </div>

        <p className="text-sm text-muted line-clamp-2">{item.summary}</p>

        {item.draftResponse && (
          <div className="bg-surface2 border border-border rounded-xl p-3 text-sm text-fg/90">
            {item.draftResponse}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onReject} className="btn-danger flex-1 text-xs">
            <X className="w-4 h-4" /> Dismiss
          </button>
          <Link href={`/queue/${item.id}`} className="btn-secondary flex-1 text-xs text-center">
            <Edit3 className="w-4 h-4" /> Edit
          </Link>
          <button onClick={onApprove} className="btn-primary flex-1 text-xs">
            <Check className="w-4 h-4" /> Send
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
