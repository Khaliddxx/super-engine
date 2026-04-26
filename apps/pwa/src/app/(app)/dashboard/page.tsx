"use client";

import { useQuery } from "@tanstack/react-query";
import { Send, Inbox, Check, Ban, Sparkles, Rocket, AlertTriangle } from "lucide-react";
import { api } from "../../../lib/api";
import { SkeletonLine } from "../../../components/skeleton";

type DashRes = {
  stateCounts: Record<string, number>;
  today: { invitesSent: number; dmsSent: number };
  pendingTriage: number;
};

const FUNNEL_DEFS: Array<{
  key: string;
  label: string;
  icon: React.FC<any>;
  color: string;
  states: string[];
}> = [
  { key: "in_pipe", label: "In pipeline", icon: Sparkles, color: "text-muted", states: ["NEW", "ENRICHED", "QUALIFIED"] },
  {
    key: "redesign_failed",
    label: "Redesign failed",
    icon: AlertTriangle,
    color: "text-amber-400",
    states: ["REDESIGN_FAILED"],
  },
  { key: "redesigned", label: "Redesigned", icon: Sparkles, color: "text-accent", states: ["REDESIGNED", "APPROVED_TO_SEND"] },
  { key: "sent", label: "Sent", icon: Send, color: "text-blue-400", states: ["SENT", "FOLLOWUP_1", "FOLLOWUP_2"] },
  { key: "awaiting", label: "Awaiting reply", icon: Inbox, color: "text-yellow-400", states: ["AWAITING"] },
  { key: "responded", label: "Responded", icon: Check, color: "text-green-400", states: ["RESPONDED", "BOOKED"] },
  { key: "won", label: "Won", icon: Rocket, color: "text-accent", states: ["WON"] },
  { key: "rejected", label: "Rejected / lost", icon: Ban, color: "text-red-400", states: ["REJECTED", "LOST"] },
];

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashRes>("/api/dashboard"),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });

  return (
    <div className="max-w-xl mx-auto px-4 safe-top space-y-4">
      <header className="py-4">
        <h1 className="text-xl font-serif">Dashboard</h1>
        <p className="text-xs text-muted">Today + overall pipeline health</p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Today — invites"
          value={data?.today.invitesSent}
          loading={isLoading || !data}
        />
        <StatCard
          label="Today — DMs"
          value={data?.today.dmsSent}
          loading={isLoading || !data}
        />
        <div className="col-span-2">
          <StatCard label="Pending triage" value={data?.pendingTriage} loading={isLoading || !data} />
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-xs uppercase tracking-wider text-muted">Funnel</p>
        {FUNNEL_DEFS.map((f) => {
          const Icon = f.icon;
          const value = data ? f.states.reduce((acc, s) => acc + (data.stateCounts[s] ?? 0), 0) : null;
          return (
            <div key={f.key} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${f.color}`} />
                <span className="text-sm">{f.label}</span>
              </div>
              {value === null ? (
                <SkeletonLine className="h-4 w-6" />
              ) : (
                <span className="text-sm font-medium">{value}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, loading }: { label: string; value: number | undefined; loading: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      {loading || value === undefined ? (
        <SkeletonLine className="h-8 w-12 mt-1" />
      ) : (
        <p className="text-3xl font-serif mt-1">{value}</p>
      )}
    </div>
  );
}
