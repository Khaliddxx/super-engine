"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Pause, Plus, RefreshCw, Search, MoreVertical, LogOut, Zap, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { useAuth } from "../../../components/AuthProvider";

type Campaign = {
  id: string;
  name: string;
  niche: string;
  targetCity: string | null;
  targetCountry: string | null;
  status: string;
  maxProspects: number;
  outreachChannel: string;
  autoRedesignAfterEnrich?: boolean;
  createdAt: string;
};

type Icp = {
  countries?: string[];
  ticketBand?: string;
  excludedNicheGroups?: string[];
  successDescription?: string;
};

type Settings = {
  operator: { name: string; email: string | null; phone: string | null };
  linkedinDailyCap: number;
  claudeModel: string;
  unipileConfigured: boolean;
  slackConfigured: boolean;
  instantlyConfigured?: boolean;
  icp: Icp | null;
};

export default function ControlsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { setToken } = useAuth();

  const campaignsQ = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api<{ items: Campaign[] }>("/api/campaigns"),
    placeholderData: (prev) => prev,
  });

  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/api/settings"),
    placeholderData: (prev) => prev,
  });

  const promptsQ = useQuery({
    queryKey: ["prompts"],
    queryFn: () => api<{ items: Array<{ id: string; version: string; preview: string }> }>("/api/prompts"),
    placeholderData: (prev) => prev,
  });

  const diagQ = useQuery({
    queryKey: ["diagnostics"],
    queryFn: () =>
      api<{ checks: Array<{ service: string; ok: boolean; detail: string }> }>("/api/settings/diagnostics"),
    staleTime: 60_000,
  });

  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("AU");
  const [maxProspects, setMaxProspects] = useState(10);

  const create = useMutation({
    mutationFn: () =>
      api<{ campaign: Campaign }>("/api/campaigns", {
        method: "POST",
        body: { name, niche, targetCity: city, targetCountry: country, maxProspects },
      }),
    onSuccess: (d) => {
      toast.success(`Campaign "${d.campaign.name}" created`);
      setName("");
      setNiche("");
      setCity("");
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const toggle = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/api/campaigns/${id}/status`, { method: "POST", body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });

  const patchAutoRedesign = useMutation({
    mutationFn: ({ id, v }: { id: string; v: boolean }) =>
      api(`/api/campaigns/${id}`, { method: "PATCH", body: { autoRedesignAfterEnrich: v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });

  const scan = useMutation({
    mutationFn: (id: string) => api(`/api/campaigns/${id}/scan`, { method: "POST", body: {} }),
    onSuccess: (d: any) => {
      const s = d.summary ?? {};
      const polished = (s.skippedSiteAlreadyStrong ?? 0) + (s.skippedTooPolished ?? 0);
      const polishedNote = polished > 0 ? ` · skipped ${polished} strong/polished` : "";
      const weak = s.insertedWithHomepageFetchFailed ?? 0;
      const weakNote = weak > 0 ? ` · ${weak} with fetch-failed homepages` : "";
      toast.success(
        `Scanned: +${s.inserted ?? 0} new${polishedNote}${weakNote} · ${s.skippedDuplicateDomain ?? 0} dupes`,
      );
    },
    onError: (e: any) => toast.error(e.message ?? "Scan failed"),
  });

  const runCycle = useMutation({
    mutationFn: (id: string) => api(`/api/campaigns/${id}/run-cycle`, { method: "POST", body: {} }),
    onSuccess: (d: any) => {
      const c = d.counts ?? {};
      toast.success(`Cycle: enriched ${c.enriched ?? 0}, qualified ${c.qualified ?? 0}, redesigned ${c.redesigned ?? 0}`);
    },
    onError: (e: any) => toast.error(e.message ?? "Cycle failed"),
  });

  const surprise = useMutation({
    mutationFn: () =>
      api<{ campaign: Campaign; pick: { niche: string; city: string }; summary: { inserted: number } }>(
        "/api/scout/pick-and-launch",
        { method: "POST", body: { country: "AU", rank: 1, maxProspects: 10 } },
      ),
    onSuccess: (d) => {
      toast.success(`Launched "${d.campaign.name}" — ${d.summary.inserted} prospects`);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      router.push("/pipeline");
    },
    onError: (e: any) => toast.error(e.message ?? "Launch failed"),
  });

  const updateCap = useMutation({
    mutationFn: (cap: number) => api("/api/settings", { method: "POST", body: { linkedinDailyCap: cap } }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const [icpCountries, setIcpCountries] = useState("");
  const [icpTicket, setIcpTicket] = useState("");
  const [icpExcluded, setIcpExcluded] = useState("");
  const [icpSuccess, setIcpSuccess] = useState("");
  const [icpLoaded, setIcpLoaded] = useState(false);

  useEffect(() => {
    if (!settingsQ.data || icpLoaded) return;
    const icp = settingsQ.data.icp;
    if (icp) {
      setIcpCountries((icp.countries ?? []).join(", "));
      setIcpTicket(icp.ticketBand ?? "");
      setIcpExcluded((icp.excludedNicheGroups ?? []).join(", "));
      setIcpSuccess(icp.successDescription ?? "");
    }
    setIcpLoaded(true);
  }, [settingsQ.data, icpLoaded]);

  const saveIcp = useMutation({
    mutationFn: () =>
      api("/api/settings", {
        method: "POST",
        body: {
          icp: {
            countries: icpCountries
              .split(",")
              .map((s) => s.trim().toUpperCase())
              .filter(Boolean),
            ticketBand: icpTicket.trim() || undefined,
            excludedNicheGroups: icpExcluded
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean),
            successDescription: icpSuccess.trim() || undefined,
          },
        },
      }),
    onSuccess: () => {
      toast.success("ICP saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const retryBulk = useMutation({
    mutationFn: (reasons: string[]) =>
      api<{ reset: number; considered: number }>("/api/pipeline/retry-bulk", {
        method: "POST",
        body: { reasons, since: "30d" },
      }),
    onSuccess: (d) => {
      toast.success(`Requeued ${d.reset} of ${d.considered} rejected — will re-enrich next cycle`);
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Retry failed"),
  });

  return (
    <div className="max-w-xl mx-auto px-4 safe-top pb-4 space-y-4">
      <header className="py-4 flex items-center justify-between">
        <h1 className="text-xl font-serif">Controls</h1>
        <button
          onClick={() => {
            setToken(null);
            toast.success("Signed out");
          }}
          className="p-2 rounded-xl bg-surface border border-border"
          aria-label="sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      <section className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Launch campaign</h2>
          <Plus className="w-4 h-4 text-muted" />
        </div>
        <button
          onClick={() => surprise.mutate()}
          disabled={surprise.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 py-4"
        >
          <Zap className="w-4 h-4" />
          {surprise.isPending ? "Launching…" : "Surprise me — launch #1 market"}
        </button>
        <p className="text-[11px] text-muted text-center">
          Picks the top AI-ranked niche × city in AU, creates the campaign, and scrapes 10 prospects.{" "}
          <Link href="/markets" className="underline">Browse markets</Link>
        </p>

        <details className="border border-border rounded-xl">
          <summary className="px-3 py-2 text-xs text-muted cursor-pointer flex items-center justify-between">
            <span>Manual (I know what I want)</span>
            <span className="text-[10px]">tap to expand</span>
          </summary>
          <div className="p-3 space-y-3 border-t border-border">
            <input className="input" placeholder="Name (e.g. Sydney nail salons)" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="Niche (e.g. nail salon)" value={niche} onChange={(e) => setNiche(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
              <input className="input" placeholder="Country (AU/US/UK/NL)" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted">Max prospects:</label>
              <input
                type="number"
                className="input max-w-[100px]"
                min={1}
                max={50}
                value={maxProspects}
                onChange={(e) => setMaxProspects(Number(e.target.value) || 10)}
              />
            </div>
            <button
              onClick={() => create.mutate()}
              disabled={!name || !niche || !city || create.isPending}
              className="btn-secondary w-full"
            >
              {create.isPending ? "Creating…" : "Create campaign"}
            </button>
          </div>
        </details>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted px-1">Campaigns</h2>
        {campaignsQ.data?.items.length === 0 && (
          <p className="text-sm text-muted px-1">No campaigns yet. Create one above.</p>
        )}
        {campaignsQ.data?.items.map((c) => (
          <div key={c.id} className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">{c.name}</h3>
                <p className="text-xs text-muted">
                  {c.niche} · {c.targetCity}
                  {c.targetCountry ? ` ${c.targetCountry}` : ""} ·{" "}
                  <span className="capitalize">{c.status}</span>
                </p>
              </div>
              <button
                onClick={() => toggle.mutate({ id: c.id, status: c.status === "active" ? "paused" : "active" })}
                className="p-2 rounded-xl bg-surface2 border border-border"
                aria-label={c.status === "active" ? "pause" : "resume"}
              >
                {c.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => scan.mutate(c.id)}
                className="btn-secondary text-xs"
                disabled={scan.isPending}
              >
                <Search className="w-3.5 h-3.5" /> Scan places
              </button>
              <button
                onClick={() => runCycle.mutate(c.id)}
                className="btn-secondary text-xs"
                disabled={runCycle.isPending}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${runCycle.isPending ? "animate-spin" : ""}`} /> Run cycle
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-fg/90 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-border"
                checked={c.autoRedesignAfterEnrich !== false}
                onChange={(e) =>
                  patchAutoRedesign.mutate({ id: c.id, v: e.target.checked })
                }
                disabled={patchAutoRedesign.isPending}
              />
              <span>
                Auto-run AI redesign after enrich{" "}
                <span className="text-muted">(off = approve in Queue first)</span>
              </span>
            </label>
          </div>
        ))}
      </section>

      {diagQ.data && (
        <section className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Integration diagnostics</h2>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ["diagnostics"] })}
              className="text-xs text-muted"
            >
              Refresh
            </button>
          </div>
          <div className="space-y-1">
            {diagQ.data.checks.map((c) => (
              <div key={c.service} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${c.ok ? "bg-green-400" : "bg-red-400"}`} />
                  <span className="capitalize font-medium">{c.service.replace(/_/g, " ")}</span>
                </div>
                <span className={`${c.ok ? "text-muted" : "text-red-300"} truncate max-w-[55%] text-right`}>
                  {c.detail}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card p-4 space-y-2">
        <div>
          <h2 className="text-sm font-medium">Bulk retry</h2>
          <p className="text-[11px] text-muted">
            Reset rejected prospects back to NEW so they re-enrich on the next cycle. Use after fixing an
            integration (e.g. Hunter key).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => retryBulk.mutate(["no_contact"])}
            disabled={retryBulk.isPending}
            className="btn-secondary text-xs"
          >
            <RotateCw className={`w-3.5 h-3.5 ${retryBulk.isPending ? "animate-spin" : ""}`} />
            Retry no_contact
          </button>
          <button
            onClick={() => retryBulk.mutate(["domain_parked", "site_already_good", "chain_scale"])}
            disabled={retryBulk.isPending}
            className="btn-secondary text-xs"
          >
            <RotateCw className={`w-3.5 h-3.5 ${retryBulk.isPending ? "animate-spin" : ""}`} />
            Retry other
          </button>
        </div>
      </section>

      {settingsQ.data && (
        <section className="card p-4 space-y-3">
          <h2 className="text-sm font-medium">ICP (for AI market discover)</h2>
          <p className="text-[11px] text-muted">
            Used when you run &quot;AI suggest&quot; on Markets — guides Claude and filters vertical groups.
          </p>
          <input
            className="input text-sm"
            placeholder="Countries (comma) e.g. US, AU, NL"
            value={icpCountries}
            onChange={(e) => setIcpCountries(e.target.value)}
          />
          <select className="input text-sm" value={icpTicket} onChange={(e) => setIcpTicket(e.target.value)}>
            <option value="">Ticket band (any)</option>
            <option value="low">low</option>
            <option value="mid">mid</option>
            <option value="high">high</option>
          </select>
          <input
            className="input text-sm"
            placeholder="Excluded niche groups (comma) e.g. lodging, food"
            value={icpExcluded}
            onChange={(e) => setIcpExcluded(e.target.value)}
          />
          <textarea
            className="input text-sm resize-none"
            rows={3}
            placeholder="What a great client looks like for you (one paragraph)"
            value={icpSuccess}
            onChange={(e) => setIcpSuccess(e.target.value)}
          />
          <button
            type="button"
            onClick={() => saveIcp.mutate()}
            disabled={saveIcp.isPending}
            className="btn-secondary w-full text-sm"
          >
            {saveIcp.isPending ? "Saving…" : "Save ICP"}
          </button>
        </section>
      )}

      {settingsQ.data && (
        <section className="card p-4 space-y-3">
          <h2 className="text-sm font-medium">Settings</h2>
          <div className="text-xs text-muted space-y-1">
            <p>Operator: {settingsQ.data.operator.name}</p>
            <p>Model: {settingsQ.data.claudeModel}</p>
            <p>Unipile: {settingsQ.data.unipileConfigured ? "configured" : "missing"}</p>
            <p>Instantly: {settingsQ.data.instantlyConfigured ? "configured" : "missing"}</p>
            <p>Slack: {settingsQ.data.slackConfigured ? "configured" : "off"}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted whitespace-nowrap">LinkedIn daily cap:</label>
            <input
              type="number"
              className="input"
              min={1}
              max={50}
              defaultValue={settingsQ.data.linkedinDailyCap}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v && v !== settingsQ.data!.linkedinDailyCap) updateCap.mutate(v);
              }}
            />
          </div>
        </section>
      )}

      {promptsQ.data && (
        <section className="card p-4 space-y-3">
          <h2 className="text-sm font-medium">Prompts</h2>
          {promptsQ.data.items.map((p) => (
            <details key={p.id} className="border border-border rounded-xl">
              <summary className="px-3 py-2 text-sm cursor-pointer flex items-center justify-between">
                <span className="capitalize">{p.id.replace(/_/g, " ")}</span>
                <span className="text-[10px] text-muted">v{p.version}</span>
              </summary>
              <pre className="text-[11px] text-muted whitespace-pre-wrap px-3 pb-3 max-h-64 overflow-auto">
                {p.preview}
              </pre>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
