"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Filter,
  Globe,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../lib/api";
import { SkeletonRowList } from "../../../components/skeleton";

type ScoreBreakdown = {
  outdatedNeed: number;
  contactability: number;
  independentness: number;
  valuePotential: number;
  demandDepth: number;
};

type ScoutRow = {
  niche: string;
  city: string;
  country?: string;
  businessCount: number;
  avgRating: number;
  totalReviews: number;
  pctWithWebsite: number;
  pctOutdatedEstimate: number;
  opportunityScore: number;
  nicheTicketWeight: number;
  scoreBreakdown?: ScoreBreakdown;
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

type FacetsResponse = {
  country: string;
  countries: string[];
  suggestedNiches: Array<{ niche: string; samples: number; avgScore: number; avgNeed: number }>;
  suggestedCities: string[];
  activeMarkets: Array<{ niche: string; city: string; createdAt: string }>;
};

const DEFAULT_COUNTRY = "US";

function ticketBand(weight: number): "high" | "mid" | "low" {
  if (weight >= 1.4) return "high";
  if (weight >= 1.0) return "mid";
  return "low";
}

export default function MarketsPage() {
  const qc = useQueryClient();
  const router = useRouter();

  const [country, setCountry] = useState<string>(DEFAULT_COUNTRY);
  const [customNiche, setCustomNiche] = useState("");
  const [customCity, setCustomCity] = useState("");
  const [query, setQuery] = useState("");
  const [minNeed, setMinNeed] = useState(20);
  const [ticket, setTicket] = useState<"all" | "high" | "mid" | "low">("all");
  const [sortBy, setSortBy] = useState<"score" | "need" | "reviews" | "freshness">("score");
  const [diversify, setDiversify] = useState(true);

  const facetsQ = useQuery({
    queryKey: ["scout", "facets", country],
    queryFn: () => api<FacetsResponse>(`/api/scout/facets?country=${country}`),
    staleTime: 1000 * 60 * 15,
  });

  const scoutQ = useQuery({
    queryKey: ["scout", country, diversify],
    queryFn: () =>
      api<ScoutResponse>(
        `/api/scout?country=${country}&limit=60&diversify=${diversify ? "true" : "false"}`,
      ),
  });

  const refresh = useMutation({
    mutationFn: () =>
      api<{ items: ScoutRow[] }>("/api/scout/run", {
        method: "POST",
        body: { country, maxCells: 30 },
      }),
    onSuccess: () => {
      toast.success("Market radar updated");
      qc.invalidateQueries({ queryKey: ["scout", country] });
      qc.invalidateQueries({ queryKey: ["scout", "facets", country] });
    },
    onError: (e: any) => toast.error(e.message ?? "Scan failed"),
  });

  const drip = useMutation({
    mutationFn: () =>
      api<{ scrapedCampaigns?: number; totalNew?: number; skipped?: boolean }>(
        "/api/scout/auto-run-now",
        { method: "POST" },
      ),
    onSuccess: (d) => {
      if (d.skipped) {
        toast.info("Auto-scout already running");
      } else {
        toast.success(
          `Topped up ${d.scrapedCampaigns ?? 0} campaigns · ${d.totalNew ?? 0} new prospects`,
        );
        qc.invalidateQueries({ queryKey: ["pipeline"] });
      }
    },
    onError: (e: any) => toast.error(e.message ?? "Auto-scout failed"),
  });

  const launch = useMutation({
    mutationFn: (rank: number) =>
      api<LaunchResponse>("/api/scout/pick-and-launch", {
        method: "POST",
        body: { country, rank, maxProspects: 25 },
      }),
    onSuccess: (d) => {
      const skipped = (d.summary.skippedSiteAlreadyStrong ?? 0) + (d.summary.skippedTooPolished ?? 0);
      const skipNote = skipped > 0 ? ` · skipped ${skipped} polished sites` : "";
      toast.success(`Launched "${d.campaign.name}" — ${d.summary.inserted} prospects added${skipNote}`);
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
        body: {
          country,
          niche: customNiche.trim().toLowerCase(),
          city: customCity.trim(),
          maxProspects: 25,
        },
      }),
    onSuccess: (d) => {
      toast.success(`Launched "${d.campaign.name}" — ${d.summary.inserted} prospects added`);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      router.push("/pipeline");
    },
    onError: (e: any) => toast.error(e.message ?? "Launch failed"),
  });

  const items = useMemo(() => {
    const inCountry = (scoutQ.data?.items ?? []).filter((row) => (row.country ?? country) === country);
    const normalizedQuery = query.trim().toLowerCase();

    const filtered = inCountry.filter((row) => {
      if (normalizedQuery) {
        const hay = `${row.niche} ${row.city}`.toLowerCase();
        if (!hay.includes(normalizedQuery)) return false;
      }
      if (Math.round(row.pctOutdatedEstimate * 100) < minNeed) return false;
      if (ticket !== "all" && ticketBand(row.nicheTicketWeight) !== ticket) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "need") return b.pctOutdatedEstimate - a.pctOutdatedEstimate;
      if (sortBy === "reviews") return b.totalReviews - a.totalReviews;
      if (sortBy === "freshness") {
        return (b.scoreBreakdown?.outdatedNeed ?? b.pctOutdatedEstimate) - (a.scoreBreakdown?.outdatedNeed ?? a.pctOutdatedEstimate);
      }
      return b.opportunityScore - a.opportunityScore;
    });

    return sorted;
  }, [scoutQ.data?.items, country, query, minNeed, ticket, sortBy]);

  const topPick = items[0];
  const isBusy =
    refresh.isPending ||
    launch.isPending ||
    launchCustom.isPending ||
    drip.isPending ||
    scoutQ.isFetching;

  const suggestedNiches = facetsQ.data?.suggestedNiches ?? [];
  const suggestedCities = facetsQ.data?.suggestedCities ?? [];
  const activeMarkets = facetsQ.data?.activeMarkets ?? [];
  const countries = facetsQ.data?.countries ?? ["US", "AU", "UK", "NL", "CA"];

  return (
    <div className="max-w-6xl mx-auto px-4 safe-top pb-6 space-y-4">
      <header className="py-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-serif">Market Workbench</h1>
            <p className="text-xs text-muted">
              Build targeted markets and rank by real redesign need, not static country presets.
            </p>
          </div>
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="btn-secondary text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
            {refresh.isPending ? "Scanning…" : "Rescan"}
          </button>
        </div>
        <div className="card p-3 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-2 items-center">
          <label className="text-xs text-muted">Market scope</label>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="input"
          >
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
        <section className="space-y-4 lg:sticky lg:top-20">
          <div className="card p-4 space-y-3 border-accent/30">
            <p className="text-sm font-medium flex items-center gap-2">
              <Search className="w-4 h-4 text-accent" />
              Custom scout
            </p>
            <input
              value={customNiche}
              onChange={(e) => setCustomNiche(e.target.value)}
              placeholder="Niche (e.g. law firm, med spa, dentist)"
              className="input"
            />
            <input
              value={customCity}
              onChange={(e) => setCustomCity(e.target.value)}
              placeholder="City"
              className="input"
            />
            <button
              disabled={isBusy || !customNiche.trim() || !customCity.trim()}
              onClick={() => launchCustom.mutate()}
              className="btn-primary w-full"
            >
              {launchCustom.isPending ? "Launching…" : `Launch ${customNiche || "…"} in ${customCity || "…"}`}
            </button>
            <p className="text-[11px] text-muted">
              Uses dynamic scoring and still drops polished/strong sites at scrape time.
            </p>
            {suggestedNiches.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted">Suggested niches</p>
                <div className="flex flex-wrap gap-1">
                  {suggestedNiches.slice(0, 8).map((n) => (
                    <button
                      key={n.niche}
                      onClick={() => setCustomNiche(n.niche)}
                      className="pill bg-surface2 text-xs"
                    >
                      {n.niche}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {suggestedCities.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted">Suggested cities</p>
                <div className="flex flex-wrap gap-1">
                  {suggestedCities.slice(0, 8).map((c) => (
                    <button
                      key={c}
                      onClick={() => setCustomCity(c)}
                      className="pill bg-surface2 text-xs"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card p-4 space-y-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Filter className="w-4 h-4 text-accent" />
              Radar filters
            </p>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search niche or city"
              className="input"
            />
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Min redesign need</span>
                <span>{minNeed}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={minNeed}
                onChange={(e) => setMinNeed(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={ticket} onChange={(e) => setTicket(e.target.value as any)} className="input text-sm">
                <option value="all">All ticket bands</option>
                <option value="high">High ticket</option>
                <option value="mid">Mid ticket</option>
                <option value="low">Low ticket</option>
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="input text-sm">
                <option value="score">Sort: score</option>
                <option value="need">Sort: need</option>
                <option value="reviews">Sort: reviews</option>
                <option value="freshness">Sort: freshness</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={diversify}
                onChange={(e) => setDiversify(e.target.checked)}
              />
              Diversify by niche
            </label>
          </div>

          <button
            disabled={drip.isPending}
            onClick={() => drip.mutate()}
            className="card p-3 w-full flex items-center gap-3 hover:border-accent/40 transition"
          >
            <div className="rounded-xl bg-accent/10 border border-accent/30 p-2 text-accent shrink-0">
              <RefreshCw className={`w-4 h-4 ${drip.isPending ? "animate-spin" : ""}`} />
            </div>
            <div className="text-left min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {drip.isPending ? "Topping up…" : "Drip more from active campaigns"}
              </p>
              <p className="text-[11px] text-muted truncate">
                Re-runs Places on active campaigns. No new campaigns launched.
              </p>
            </div>
          </button>
        </section>

        <section className="space-y-3">
          <div className="card p-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Opportunity radar</p>
              <p className="text-[11px] text-muted">
                {scoutQ.data?.meta
                  ? `${items.length} shown · ${scoutQ.data.meta.totalOpportunities} scanned · ${scoutQ.data.meta.note}`
                  : "Scanning markets…"}
              </p>
            </div>
            <button
              disabled={isBusy || !topPick}
              onClick={() => launch.mutate(1)}
              className="btn-primary text-xs"
            >
              <Zap className="w-4 h-4" />
              {launch.isPending ? "Launching…" : topPick ? `Launch top pick (${topPick.niche} · ${topPick.city})` : "No pick yet"}
            </button>
          </div>

          {scoutQ.isLoading && <SkeletonRowList count={6} />}

          {!scoutQ.isLoading && items.length === 0 && (
            <div className="card p-6 text-center space-y-3">
              <Sparkles className="w-6 h-6 text-accent mx-auto" />
              <p className="text-sm">No scoped opportunities match these filters.</p>
              <p className="text-xs text-muted">Try lowering min need, clearing search, or rescanning.</p>
            </div>
          )}

          <div className="hidden md:block card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface2 text-muted text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Market</th>
                  <th className="text-left px-3 py-2">Need</th>
                  <th className="text-left px-3 py-2">Score</th>
                  <th className="text-left px-3 py-2">Reviews</th>
                  <th className="text-left px-3 py-2">Website %</th>
                  <th className="text-right px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 30).map((m, i) => (
                  <tr key={`${m.country}-${m.niche}-${m.city}-${i}`} className="border-t border-border">
                    <td className="px-3 py-2">
                      <p className="font-medium capitalize">{m.niche}</p>
                      <p className="text-xs text-muted">{m.city} · {m.country ?? country}</p>
                    </td>
                    <td className="px-3 py-2">{Math.round(m.pctOutdatedEstimate * 100)}%</td>
                    <td className="px-3 py-2">{m.opportunityScore.toFixed(1)}</td>
                    <td className="px-3 py-2">{(m.totalReviews / 1000).toFixed(m.totalReviews >= 10000 ? 0 : 1)}k</td>
                    <td className="px-3 py-2">{Math.round(m.pctWithWebsite * 100)}%</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => launch.mutate(i + 1)}
                        disabled={isBusy}
                        className="btn-secondary text-xs"
                      >
                        Launch
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2">
            {items.slice(0, 30).map((m, i) => (
              <button
                key={`${m.country}-${m.niche}-${m.city}-${i}`}
                onClick={() => launch.mutate(i + 1)}
                disabled={isBusy}
                className="card w-full text-left p-4 flex items-start gap-3 hover:bg-surface2 disabled:opacity-50"
              >
                <div className="text-xs text-muted font-mono w-7 text-center">#{i + 1}</div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium truncate capitalize">{m.niche} · {m.city}</p>
                  <div className="flex items-center gap-2 text-xs text-muted flex-wrap">
                    <span className="pill bg-accent/10 text-accent">{Math.round(m.pctOutdatedEstimate * 100)}% need</span>
                    <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />{m.opportunityScore.toFixed(1)}</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" />{(m.totalReviews / 1000).toFixed(m.totalReviews >= 10000 ? 0 : 1)}k</span>
                    <span className="flex items-center gap-1"><Star className="w-3 h-3" />{m.avgRating.toFixed(1)}</span>
                    <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{Math.round(m.pctWithWebsite * 100)}%</span>
                  </div>
                </div>
                <Zap className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              </button>
            ))}
          </div>

          {activeMarkets.length > 0 && (
            <div className="card p-3">
              <p className="text-xs text-muted mb-2">Active markets ({country})</p>
              <div className="flex flex-wrap gap-1">
                {activeMarkets.slice(0, 16).map((m, i) => (
                  <button
                    key={`${m.niche}-${m.city}-${i}`}
                    onClick={() => {
                      setCustomNiche(m.niche);
                      setCustomCity(m.city);
                    }}
                    className="pill bg-surface2 text-xs"
                  >
                    {m.niche} · {m.city}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
