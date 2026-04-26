"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../../../lib/api";
import { SkeletonLine } from "../../../../../components/skeleton";

type Res = {
  prospect: any;
  studioBookingUrl: string | null;
  studioBookingMailto: string | null;
};

/** Lovable-style: live iframe + AI edit panel beside it (operator-only; auth via API). */
export default function PipelinePreviewStudioPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [instruction, setInstruction] = useState("");
  const [previewCacheKey, setPreviewCacheKey] = useState(0);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["pipeline", id],
    queryFn: () => api<Res>(`/api/pipeline/${id}`),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const patchNavbar = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; url: string; warnings: string[] }>(`/api/pipeline/${id}/redesign-html-patch`, {
        method: "POST",
        body: { scope: "navbar", instruction: instruction.trim() },
      }),
    onSuccess: (r) => {
      toast.success("Navbar updated — preview redeployed");
      if (r.warnings?.length) toast.warning(r.warnings.slice(0, 5).join(" · "));
      setInstruction("");
      setPreviewCacheKey((k) => k + 1);
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? "Patch failed"),
  });

  const p = data?.prospect;
  const url = p?.redesignHtmlUrl as string | undefined;
  const bookHref = data?.studioBookingUrl ?? data?.studioBookingMailto ?? null;
  const bookNewTab = Boolean(data?.studioBookingUrl);

  if (isLoading || !data) {
    return (
      <div className="px-4 safe-top pb-4 space-y-3 max-w-4xl mx-auto">
        <SkeletonLine className="h-8 w-40" />
        <SkeletonLine className="h-[50vh] w-full rounded-lg" />
      </div>
    );
  }

  if (!url) {
    return (
      <div className="px-4 safe-top pb-4 max-w-xl mx-auto space-y-3">
        <Link href={`/pipeline/${id}`} className="inline-flex items-center gap-1 text-muted text-sm">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <p className="text-sm text-fg/80">No redesign preview for this prospect yet.</p>
      </div>
    );
  }

  const iframeSrc =
    previewCacheKey > 0 ? `${url}${url.includes("?") ? "&" : "?"}_se=${previewCacheKey}` : url;

  return (
    <div className="flex flex-col h-[calc(100dvh-5.25rem)] min-h-[320px] -mb-4">
      <header className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-surface/80 backdrop-blur">
        <Link
          href={`/pipeline/${id}`}
          className="inline-flex items-center gap-1 text-muted text-sm hover:text-fg shrink-0"
        >
          <ArrowLeft className="w-4 h-4" /> Pipeline
        </Link>
        <div className="hidden sm:flex items-center gap-1.5 text-sm font-medium text-fg/90 min-w-0">
          <Sparkles className="w-4 h-4 text-accent shrink-0" />
          <span className="truncate">{p?.businessName ?? "Preview"}</span>
        </div>
        <span className="text-xs text-muted hidden md:inline">Studio preview</span>
        <div className="flex-1 min-w-2" />
        {bookHref ? (
          <a
            href={bookHref}
            {...(bookNewTab ? { target: "_blank", rel: "noreferrer" } : {})}
            className="btn text-xs shrink-0"
          >
            <CalendarClock className="w-3.5 h-3.5" /> Book 15-min
          </a>
        ) : (
          <span
            className="text-xs text-muted px-2 py-1 border border-border rounded-lg"
            title="Set STUDIO_BOOKING_URL or OPERATOR_EMAIL on the orchestrator"
          >
            Booking not configured
          </span>
        )}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary text-xs shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Open site
        </a>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <div className="flex-1 min-h-[40vh] lg:min-h-0 flex flex-col bg-black/5">
          <iframe
            key={previewCacheKey}
            title="Redesign preview"
            src={iframeSrc}
            className="flex-1 w-full min-h-0 border-0 bg-white"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation-by-user-activation"
            referrerPolicy="no-referrer"
          />
        </div>

        <aside className="lg:w-[min(100%,420px)] shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-surface flex flex-col max-h-[45vh] lg:max-h-none">
          <div className="px-3 py-2 border-b border-border space-y-0.5">
            <p className="text-sm font-medium">Edit with AI</p>
            <p className="text-[11px] text-muted leading-snug">
              Describe navbar changes only. Applies to the live preview URL after redeploy — like a Lovable-style
              side chat for quick fixes.
            </p>
          </div>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={patchNavbar.isPending}
            className="flex-1 min-h-[140px] mx-3 mt-3 input resize-none text-sm"
            placeholder='e.g. "Make the nav minimal: logo left, three links, one primary Schedule button on the right"'
          />
          <div className="p-3 pt-2 space-y-2">
            <button
              type="button"
              className="btn-primary w-full text-sm"
              disabled={patchNavbar.isPending || !instruction.trim()}
              onClick={() => patchNavbar.mutate()}
            >
              {patchNavbar.isPending ? "Applying…" : "Apply to preview"}
            </button>
            <p className="text-[10px] text-muted text-center">
              Full redesign still lives on the pipeline detail page.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
