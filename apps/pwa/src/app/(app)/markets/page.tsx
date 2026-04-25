"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Sparkles, TrendingUp, RefreshCw, Zap, Star, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../lib/api";

type ScoutRow = {
  niche: string;
  city: string;
  businessCount: number;
  avgRating: number;
  totalReviews: number;
  pctWithWebsite: number;
  opportunityScore: number;
  nicheTicketWeight: number;
};

type LaunchResponse = {
  campaign: { id: string; name: string; niche: string; targetCity: string | null };
  pick: ScoutRow;
  summary: { found: number; inserted: number; skippedDuplicateDomain: number; skippedNoWebsite: number };
};

const COUNTRIES = ["AU", "US", "UK", "NL"] as const;

export default function MarketsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [country, setCountry] = useState<(typeof COUNTRIES)[number]>("AU");

  const scoutQ = useQuery({
    queryKey: ["scout", country],
    queryFn: () => api<{ country: string; items: ScoutRow[] }>(`/api/scout?country=${country}&limit=10`),
  });

  const refresh = useMutation({
    mutationFn: () => api<{ items: ScoutRow[] }>("/api/scout/run", { method: "POST", body: { country, maxCells: 30 } }),
    onSuccess: () => {
      toast.success("Fresh scan complete");
      qc.invalidateQueries({ queryKey: ["scout"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Scan failed"),
  });

  const launch = useMutation({
    mutationFn: (rank: number) =>
      api<LaunchResponse>("/api/scout/pick-and-launch", {
        method: "POST",
        body: { country, rank, maxProspects: 10 },
      }),
    onSuccess: (d) => {
      toast.success(
        `Launched "${d.campaign.name}" — ${d.summary.inserted} prospects added`,
      );
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      router.push("/pipeline");
    },
    onError: (e: any) => toast.error(e.message ?? "Launch failed"),
  });

  const surprise = () => {
    launch.mutate(1);
  };

  const items = scoutQ.data?.items ?? [];
  const isBusy = refresh.isPending || launch.isPending;

  return (
    <div className="max-w-xl mx-auto px-4 safe-top pb-4 space-y-4">
      <header className="py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-serif">Markets</h1>
          <p className="text-xs text-muted">AI-ranked niche × city opportunities</p>
        </div>
        <div className="flex gap-1 bg-surface border border-border rounded-xl p-1">
          {COUNTRIES.map((c) => (
            <button
              key={c}
              onClick={() => setCountry(c)}
              className={`text-xs px-2 py-1 rounded-lg ${
                country === c ? "bg-accent text-bg font-medium" : "text-muted"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </header>

      <button
        disabled={isBusy || items.length === 0}
        onClick={surprise}
        className="btn-primary w-full flex items-center justify-center gap-2 py-4"
      >
        <Zap className="w-4 h-4" />
        {launch.isPending && launch.variables === 1
          ? "Launching…"
          : items.length
            ? `Surprise me — launch #1 (${items[0]!.niche} in ${items[0]!.city})`
            : "Run a scan first"}
      </button>

      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-medium text-muted">Top opportunities</h2>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="text-xs text-muted flex items-center gap-1 p-1"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
          {refresh.isPending ? "Scanning…" : "Rescan"}
        </button>
      </div>

      {scoutQ.isLoading && <div className="text-muted text-sm py-10 text-center">Loading…</div>}

      {!scoutQ.isLoading && items.length === 0 && (
        <div className="card p-6 text-center space-y-3">
          <Sparkles className="w-6 h-6 text-accent mx-auto" />
          <p className="text-sm">No scan yet for {country}.</p>
          <p className="text-xs text-muted">Rescan takes ~2 min — ranks top niche × city combos by opportunity.</p>
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="btn-primary w-full"
          >
            {refresh.isPending ? "Scanning…" : "Run first scan"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {items.map((m, i) => (
          <button
            key={`${m.niche}-${m.city}`}
            onClick={() => launch.mutate(i + 1)}
            disabled={isBusy}
            className="card w-full text-left p-4 flex items-center gap-3 hover:bg-surface2 disabled:opacity-50"
          >
            <div className="text-xs text-muted font-mono w-6 text-center">#{i + 1}</div>
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate capitalize">
                {m.niche} · {m.city}
              </p>
              <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {m.businessCount}
                </span>
                <span className="flex items-center gap-1">
                  <Star className="w-3 h-3" />
                  {m.avgRating.toFixed(1)}
                </span>
                <span className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-accent" />
                  {m.opportunityScore.toFixed(1)}
                </span>
              </div>
            </div>
            <Zap className="w-4 h-4 text-accent shrink-0" />
          </button>
        ))}
      </div>

      <p className="text-[11px] text-muted text-center pt-2">
        Tap a card to auto-create campaign + scrape prospects. No manual niche/city picking.
      </p>
    </div>
  );
}
