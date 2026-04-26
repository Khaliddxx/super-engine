"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Sparkles, TrendingUp, RefreshCw, Zap, Star, Users, Globe, Search, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../lib/api";
import { SkeletonRowList } from "../../../components/skeleton";

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
  pick?: ScoutRow;
  summary: {
    found: number;
    inserted: number;
    skippedDuplicateDomain: number;
    skippedNoWebsite: number;
    skippedSiteAlreadyStrong?: number;
    skippedTooPolished?: number;
    skippedChainDomain?: number;
  };
};

type ScoutResponse = {
  country: string;
  items: ScoutRow[];
  meta: {
    totalOpportunities: number;
    nichesScanned: number;
    citiesScanned: number;
    cacheHit: boolean;
    note: string;
  };
};

type CatalogResponse = {
  niches: Array<{ niche: string; weight: number }>;
  countries: Array<{ country: string; cities: string[] }>;
};

export default function MarketsPage() {
  const qc = useQueryClient();
  const router = useRouter();

  const catalogQ = useQuery({
    queryKey: ["scout", "catalog"],
    queryFn: () => api<CatalogResponse>("/api/scout/catalog"),
    staleTime: 1000 * 60 * 60, // catalog is static enough
  });

  const supportedCountries = useMemo(() => {
    const fromCatalog = catalogQ.data?.countries.map((c) => c.country) ?? [];
    return fromCatalog.length ? fromCatalog : ["AU", "US", "UK", "NL"];
  }, [catalogQ.data]);

  const [country, setCountry] = useState<string>("AU");
  const [showCustom, setShowCustom] = useState(false);
  const [customNiche, setCustomNiche] = useState("");
  const [customCity, setCustomCity] = useState("");

  const scoutQ = useQuery({
    queryKey: ["scout", country],
    queryFn: () => api<ScoutResponse>(`/api/scout?country=${country}&limit=15`),
    placeholderData: (prev) => prev, // keep showing old data while refetching for snappier nav
  });

  const refresh = useMutation({
    mutationFn: () => api<{ items: ScoutRow[] }>("/api/scout/run", { method: "POST", body: { country, maxCells: 60 } }),
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
      const skipped =
        (d.summary.skippedSiteAlreadyStrong ?? 0) +
        (d.summary.skippedTooPolished ?? 0);
      const skipNote = skipped > 0 ? ` · skipped ${skipped} polished sites` : "";
      toast.success(
        `Launched "${d.campaign.name}" — ${d.summary.inserted} prospects added${skipNote}`,
      );
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      router.push("/pipeline");
    },
    onError: (e: any) => toast.error(e.message ?? "Launch failed"),
  });

  const launchCustom = useMutation({
    mutationFn: () =>
      api<LaunchResponse>("/api/scout/launch-custom", {
        method: "POST",
        body: { country, niche: customNiche.trim().toLowerCase(), city: customCity.trim(), maxProspects: 10 },
      }),
    onSuccess: (d) => {
      const skipped =
        (d.summary.skippedSiteAlreadyStrong ?? 0) +
        (d.summary.skippedTooPolished ?? 0);
      const skipNote = skipped > 0 ? ` · skipped ${skipped} polished sites` : "";
      toast.success(
        `Launched "${d.campaign.name}" — ${d.summary.inserted} prospects added${skipNote}`,
      );
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      router.push("/pipeline");
    },
    onError: (e: any) => toast.error(e.message ?? "Launch failed"),
  });

  const items = scoutQ.data?.items ?? [];
  const meta = scoutQ.data?.meta;
  const isBusy = refresh.isPending || launch.isPending || launchCustom.isPending;

  const citiesForCountry = useMemo(
    () => catalogQ.data?.countries.find((c) => c.country === country)?.cities ?? [],
    [catalogQ.data, country],
  );

  return (
    <div className="max-w-xl mx-auto px-4 safe-top pb-4 space-y-4">
      <header className="py-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-serif">Markets</h1>
          <p className="text-xs text-muted truncate">
            {meta
              ? `${meta.totalOpportunities} opportunities · ${meta.nichesScanned} niches × ${meta.citiesScanned} cities`
              : catalogQ.isLoading
                ? "Loading catalog…"
                : `${catalogQ.data?.niches.length ?? 0} niches across ${supportedCountries.length} countries`}
          </p>
        </div>
        <div className="flex gap-1 bg-surface border border-border rounded-xl p-1 overflow-x-auto max-w-[55%] no-scrollbar">
          {supportedCountries.map((c) => (
            <button
              key={c}
              onClick={() => setCountry(c)}
              className={`text-xs px-2 py-1 rounded-lg shrink-0 ${
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
        onClick={() => launch.mutate(1)}
        className="btn-primary w-full flex items-center justify-center gap-2 py-4"
      >
        <Zap className="w-4 h-4" />
        {launch.isPending && launch.variables === 1
          ? "Launching…"
          : items.length
            ? `Surprise me — launch #1 (${items[0]!.niche} in ${items[0]!.city})`
            : refresh.isPending
              ? "Scanning…"
              : "Run a scan first"}
      </button>

      <div className="card p-3 space-y-3">
        <button
          onClick={() => setShowCustom((s) => !s)}
          className="flex items-center justify-between w-full text-left"
        >
          <span className="text-sm flex items-center gap-2">
            <Search className="w-4 h-4 text-accent" />
            Or pick exactly what to scout
          </span>
          <Plus
            className={`w-4 h-4 text-muted transition-transform ${showCustom ? "rotate-45" : ""}`}
          />
        </button>
        {showCustom && (
          <div className="space-y-2">
            <input
              list="niche-list"
              value={customNiche}
              onChange={(e) => setCustomNiche(e.target.value)}
              placeholder="Niche (e.g. orthodontist, wedding venue, …)"
              className="input"
            />
            <datalist id="niche-list">
              {catalogQ.data?.niches.map((n) => (
                <option key={n.niche} value={n.niche} />
              ))}
            </datalist>
            <input
              list="city-list"
              value={customCity}
              onChange={(e) => setCustomCity(e.target.value)}
              placeholder="City (e.g. Edinburgh)"
              className="input"
            />
            <datalist id="city-list">
              {citiesForCountry.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <button
              disabled={isBusy || !customNiche.trim() || !customCity.trim()}
              onClick={() => launchCustom.mutate()}
              className="btn-primary w-full"
            >
              {launchCustom.isPending ? "Launching…" : `Launch ${customNiche || "…"} in ${customCity || "…"}`}
            </button>
            <p className="text-[11px] text-muted">
              Custom launches still apply the outdated-site filter — polished businesses are dropped before insertion.
            </p>
          </div>
        )}
      </div>

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

      {scoutQ.isLoading && <SkeletonRowList count={6} />}

      {!scoutQ.isLoading && items.length === 0 && (
        <div className="card p-6 text-center space-y-3">
          <Sparkles className="w-6 h-6 text-accent mx-auto" />
          <p className="text-sm">No scan yet for {country}.</p>
          <p className="text-xs text-muted">Each rescan samples ~60 fresh niche × city combos. The cache aggregates across runs.</p>
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
        {items.map((m, i) => {
          const ticket = m.nicheTicketWeight >= 1.4 ? "high" : m.nicheTicketWeight >= 1.0 ? "mid" : "low";
          return (
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
                <div className="flex items-center gap-3 text-xs text-muted mt-0.5 flex-wrap">
                  <span className="flex items-center gap-1" title="Reviews across the top-20 results">
                    <Users className="w-3 h-3" />
                    {(m.totalReviews / 1000).toFixed(m.totalReviews >= 10000 ? 0 : 1)}k
                  </span>
                  <span className="flex items-center gap-1">
                    <Star className="w-3 h-3" />
                    {m.avgRating.toFixed(1)}
                  </span>
                  <span className="flex items-center gap-1" title="% of top results that have a website at all">
                    <Globe className="w-3 h-3" />
                    {Math.round(m.pctWithWebsite * 100)}%
                  </span>
                  <span className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-accent" />
                    {m.opportunityScore.toFixed(1)}
                  </span>
                  <span
                    className={`pill ${
                      ticket === "high"
                        ? "bg-accent/15 text-accent"
                        : ticket === "mid"
                          ? "bg-surface2 text-fg"
                          : "bg-surface2 text-muted"
                    }`}
                  >
                    {ticket} ticket
                  </span>
                </div>
              </div>
              <Zap className="w-4 h-4 text-accent shrink-0" />
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-muted text-center pt-2">
        Tap a card to spin up a campaign. Outdated-site filtering happens at scrape — polished businesses are dropped before insertion.
      </p>
    </div>
  );
}
