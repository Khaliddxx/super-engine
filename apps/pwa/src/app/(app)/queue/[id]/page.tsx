"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, X, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../../lib/api";

type DetailRes = {
  triage: any;
  prospect: any;
  thread: any;
  messages: any[];
};

export default function TriageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["queue", id],
    queryFn: () => api<DetailRes>(`/api/queue/${id}`),
  });

  const [text, setText] = useState("");
  useEffect(() => {
    if (data) {
      setText(data.triage.editedResponse ?? data.triage.draftResponse ?? "");
    }
  }, [data]);

  const approve = useMutation({
    mutationFn: () => api(`/api/queue/${id}/approve`, { method: "POST", body: { text } }),
    onSuccess: () => {
      toast.success("Sent");
      qc.invalidateQueries({ queryKey: ["queue"] });
      router.replace("/queue");
    },
    onError: (e: any) => toast.error(e.message ?? "Send failed"),
  });

  const reject = useMutation({
    mutationFn: () => api(`/api/queue/${id}/reject`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast.success("Dismissed");
      qc.invalidateQueries({ queryKey: ["queue"] });
      router.replace("/queue");
    },
  });

  if (isLoading || !data) return <div className="p-6 text-muted text-sm">Loading…</div>;

  const { triage, prospect, messages } = data;
  const confidence = triage.confidence ? Math.round(Number(triage.confidence) * 100) : null;

  return (
    <div className="max-w-xl mx-auto px-4 safe-top pb-4">
      <header className="flex items-center justify-between py-3">
        <Link href="/queue" className="flex items-center gap-1 text-muted text-sm">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        {prospect?.redesignHtmlUrl && (
          <a
            href={prospect.redesignHtmlUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary text-xs"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Preview
          </a>
        )}
      </header>

      <div className="space-y-4">
        <div className="card p-4 space-y-1">
          <h2 className="font-serif text-lg">{prospect?.businessName}</h2>
          <p className="text-xs text-muted">
            {prospect?.niche}
            {prospect?.city ? ` · ${prospect.city}` : ""}
          </p>
          <div className="flex gap-2 mt-3 flex-wrap">
            <span className="pill border border-border text-fg bg-surface2 capitalize">
              {triage.classification}
            </span>
            <span className="pill border border-border text-fg bg-surface2 capitalize">
              priority: {triage.priority}
            </span>
            {confidence !== null && (
              <span className="pill border border-border text-fg bg-surface2">{confidence}% conf.</span>
            )}
          </div>
        </div>

        <div className="card p-4">
          <p className="text-xs uppercase tracking-wider text-muted mb-3">Thread</p>
          <div className="space-y-2">
            {messages.map((m: any) => (
              <div
                key={m.id}
                className={`rounded-xl p-3 text-sm ${
                  m.direction === "out"
                    ? "bg-accent/10 border border-accent/20 ml-4"
                    : "bg-surface2 border border-border mr-4"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                  {m.direction === "out" ? "you" : prospect?.businessName}
                </div>
                <div className="whitespace-pre-wrap text-fg/90">{m.content}</div>
              </div>
            ))}
          </div>
        </div>

        {triage.reasoning && (
          <div className="card p-4">
            <p className="text-xs uppercase tracking-wider text-muted mb-1">AI reasoning</p>
            <p className="text-sm text-fg/80">{triage.reasoning}</p>
          </div>
        )}

        <div className="card p-4 space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted">Your reply</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="input resize-none font-normal"
            placeholder="Write or edit the response…"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button className="btn-danger flex-1" onClick={() => reject.mutate()} disabled={reject.isPending}>
            <X className="w-4 h-4" /> Dismiss
          </button>
          <button
            className="btn-primary flex-1"
            onClick={() => approve.mutate()}
            disabled={approve.isPending || !text.trim()}
          >
            <Check className="w-4 h-4" /> {approve.isPending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
