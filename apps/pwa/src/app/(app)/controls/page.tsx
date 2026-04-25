"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Pause, Plus, RefreshCw, Search, MoreVertical, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import Link from "next/link";
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
  createdAt: string;
};

type Settings = {
  operator: { name: string; email: string | null; phone: string | null };
  linkedinDailyCap: number;
  claudeModel: string;
  unipileConfigured: boolean;
  slackConfigured: boolean;
};

export default function ControlsPage() {
  const qc = useQueryClient();
  const { setToken } = useAuth();

  const campaignsQ = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api<{ items: Campaign[] }>("/api/campaigns"),
  });

  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/api/settings"),
  });

  const promptsQ = useQuery({
    queryKey: ["prompts"],
    queryFn: () => api<{ items: Array<{ id: string; version: string; preview: string }> }>("/api/prompts"),
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

  const scan = useMutation({
    mutationFn: (id: string) => api(`/api/campaigns/${id}/scan`, { method: "POST", body: {} }),
    onSuccess: (d: any) => {
      toast.success(`Scanned: +${d.summary?.inserted ?? 0} new, ${d.summary?.skippedDuplicateDomain ?? 0} dupes`);
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

  const updateCap = useMutation({
    mutationFn: (cap: number) => api("/api/settings", { method: "POST", body: { linkedinDailyCap: cap } }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
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
          <h2 className="text-sm font-medium">New campaign</h2>
          <Plus className="w-4 h-4 text-muted" />
        </div>
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
          className="btn-primary w-full"
        >
          {create.isPending ? "Creating…" : "Create campaign"}
        </button>
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
          </div>
        ))}
      </section>

      {settingsQ.data && (
        <section className="card p-4 space-y-3">
          <h2 className="text-sm font-medium">Settings</h2>
          <div className="text-xs text-muted space-y-1">
            <p>Operator: {settingsQ.data.operator.name}</p>
            <p>Model: {settingsQ.data.claudeModel}</p>
            <p>Unipile: {settingsQ.data.unipileConfigured ? "configured" : "missing"}</p>
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
