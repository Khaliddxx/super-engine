"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../../../lib/api";
import { SkeletonLine } from "../../../../../components/skeleton";
import { useAuth } from "../../../../../components/AuthProvider";

type Res = {
  prospect: any;
  studioBookingUrl: string | null;
  studioBookingMailto: string | null;
};

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
}

/** Lovable-style: live iframe + AI edit panel beside it. Operator JWT or studio-preview password. */
export default function PipelinePreviewStudioPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { token, setToken, loading: authLoading } = useAuth();
  const [instruction, setInstruction] = useState("");
  const [previewCacheKey, setPreviewCacheKey] = useState(0);
  const [studioPw, setStudioPw] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["pipeline", id],
    queryFn: () => api<Res>(`/api/pipeline/${id}`),
    enabled: Boolean(!authLoading && token),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
    retry: false,
  });

  useEffect(() => {
    if (!isError || !error) return;
    const msg = String((error as Error).message);
    if (/failed: 401\b/.test(msg)) {
      setToken(null);
      toast.error("Session expired — sign in or unlock with the preview password");
    }
  }, [isError, error, setToken]);

  const unlockStudio = useMutation({
    mutationFn: async (password: string) => {
      const res = await fetch(`${apiBase()}/api/auth/studio-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok) {
        const code = j.error ?? `http_${res.status}`;
        if (code === "studio_preview_password_not_configured") {
          throw new Error("Preview password not configured — set it under Controls in the portal");
        }
        if (code === "invalid_password") throw new Error("Wrong password");
        throw new Error(code);
      }
      if (!j.token) throw new Error("no_token");
      return j.token;
    },
    onSuccess: (t) => {
      setToken(t);
      setStudioPw("");
      toast.success("Unlocked — you can edit the preview");
      void qc.invalidateQueries({ queryKey: ["pipeline", id] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Unlock failed"),
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

  if (authLoading) {
    return (
      <div className="px-4 safe-top pb-4 space-y-3 max-w-4xl mx-auto">
        <SkeletonLine className="h-8 w-40" />
        <SkeletonLine className="h-[50vh] w-full rounded-lg" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="px-4 safe-top pb-4 max-w-md mx-auto space-y-4">
        <Link href={`/pipeline/${id}`} className="inline-flex items-center gap-1 text-muted text-sm">
          <ArrowLeft className="w-4 h-4" /> Pipeline
        </Link>
        <div className="card p-4 space-y-3">
          <h1 className="text-sm font-medium">Unlock preview studio</h1>
          <p className="text-xs text-muted leading-relaxed">
            Enter the studio preview password from your Super Engine Controls. This is separate from your main
            operator login and is not stored on client preview websites.
          </p>
          <input
            type="password"
            autoComplete="current-password"
            className="input text-sm w-full"
            placeholder="Preview password"
            value={studioPw}
            onChange={(e) => setStudioPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && studioPw.trim()) unlockStudio.mutate(studioPw.trim());
            }}
          />
          <button
            type="button"
            className="btn-primary w-full text-sm"
            disabled={unlockStudio.isPending || !studioPw.trim()}
            onClick={() => unlockStudio.mutate(studioPw.trim())}
          >
            {unlockStudio.isPending ? "Checking…" : "Unlock"}
          </button>
          <p className="text-[11px] text-muted text-center">
            <Link href="/login" className="underline hover:text-fg">
              Operator sign in
            </Link>{" "}
            instead
          </p>
        </div>
      </div>
    );
  }

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
