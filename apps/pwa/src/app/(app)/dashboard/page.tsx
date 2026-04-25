"use client";

import { useQuery } from "@tanstack/react-query";
import { Send, Inbox, Check, Ban, Sparkles, Rocket } from "lucide-react";
import { api } from "../../../lib/api";

type DashRes = {
  stateCounts: Record<string, number>;
  today: { invitesSent: number; dmsSent: number };
  pendingTriage: number;
};

export default function DashboardPage() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashRes>("/api/dashboard"),
    refetchInterval: 15_000,
  });

  if (!data) return <div className="p-6 text-muted text-sm">Loading…</div>;
  const s = data.stateCounts;

  const funnel = [
    { label: "In pipeline", value: (s.NEW ?? 0) + (s.ENRICHED ?? 0) + (s.QUALIFIED ?? 0), icon: Sparkles, color: "text-muted" },
    { label: "Redesigned", value: (s.REDESIGNED ?? 0) + (s.APPROVED_TO_SEND ?? 0), icon: Sparkles, color: "text-accent" },
    { label: "Sent", value: (s.SENT ?? 0) + (s.FOLLOWUP_1 ?? 0) + (s.FOLLOWUP_2 ?? 0), icon: Send, color: "text-blue-400" },
    { label: "Awaiting reply", value: s.AWAITING ?? 0, icon: Inbox, color: "text-yellow-400" },
    { label: "Responded", value: (s.RESPONDED ?? 0) + (s.BOOKED ?? 0), icon: Check, color: "text-green-400" },
    { label: "Won", value: s.WON ?? 0, icon: Rocket, color: "text-accent" },
    { label: "Rejected / lost", value: (s.REJECTED ?? 0) + (s.LOST ?? 0), icon: Ban, color: "text-red-400" },
  ];

  return (
    <div className="max-w-xl mx-auto px-4 safe-top space-y-4">
      <header className="py-4">
        <h1 className="text-xl font-serif">Dashboard</h1>
        <p className="text-xs text-muted">Today + overall pipeline health</p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wider text-muted">Today — invites</p>
          <p className="text-3xl font-serif mt-1">{data.today.invitesSent}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wider text-muted">Today — DMs</p>
          <p className="text-3xl font-serif mt-1">{data.today.dmsSent}</p>
        </div>
        <div className="card p-4 col-span-2">
          <p className="text-xs uppercase tracking-wider text-muted">Pending triage</p>
          <p className="text-3xl font-serif mt-1">{data.pendingTriage}</p>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-xs uppercase tracking-wider text-muted">Funnel</p>
        {funnel.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${f.color}`} />
                <span className="text-sm">{f.label}</span>
              </div>
              <span className="text-sm font-medium">{f.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
