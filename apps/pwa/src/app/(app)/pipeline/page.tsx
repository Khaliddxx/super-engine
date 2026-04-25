"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronRight, Sparkles, AlertCircle, Check, Send, Inbox, Ban } from "lucide-react";
import { api } from "../../../lib/api";
import { useState } from "react";

type Row = {
  id: string;
  state: string;
  businessName: string;
  niche: string;
  city: string | null;
  redesignHtmlUrl: string | null;
  rejectionReason: string | null;
  qualificationScore: string | null;
  qualificationIssues: string[] | null;
};

const GROUPS: Array<{ key: string; label: string; states: string[]; color: string; icon: React.FC<any> }> = [
  { key: "redesigned", label: "Redesigned — review & send", states: ["REDESIGNED"], color: "text-accent", icon: Sparkles },
  { key: "approved", label: "Approved to send", states: ["APPROVED_TO_SEND"], color: "text-yellow-400", icon: Send },
  { key: "sent", label: "Sent / awaiting", states: ["SENT", "AWAITING", "FOLLOWUP_1", "FOLLOWUP_2"], color: "text-blue-400", icon: Inbox },
  { key: "responded", label: "Responded / booked / won", states: ["RESPONDED", "BOOKED", "WON"], color: "text-green-400", icon: Check },
  { key: "in_progress", label: "Enriching & qualifying", states: ["NEW", "ENRICHED", "QUALIFIED"], color: "text-muted", icon: AlertCircle },
  { key: "rejected", label: "Rejected / lost", states: ["REJECTED", "LOST"], color: "text-red-400", icon: Ban },
];

export default function PipelinePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["pipeline"],
    queryFn: () => api<{ items: Row[] }>("/api/pipeline"),
    refetchInterval: 15_000,
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ redesigned: true, approved: true });
  const items = data?.items ?? [];

  return (
    <div className="max-w-xl mx-auto px-4 safe-top">
      <header className="py-4">
        <h1 className="text-xl font-serif">Pipeline</h1>
        <p className="text-xs text-muted">{items.length} prospects · tap a row for detail</p>
      </header>

      {isLoading && <div className="text-muted text-sm py-10 text-center">Loading…</div>}

      <div className="space-y-4">
        {GROUPS.map((g) => {
          const rows = items.filter((i) => g.states.includes(i.state));
          if (!rows.length) return null;
          const isOpen = expanded[g.key] ?? false;
          const Icon = g.icon;
          return (
            <section key={g.key} className="card overflow-hidden">
              <button
                onClick={() => setExpanded((s) => ({ ...s, [g.key]: !isOpen }))}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface2"
              >
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${g.color}`} />
                  <span className="text-sm font-medium">{g.label}</span>
                  <span className="pill bg-surface2 border border-border text-muted">{rows.length}</span>
                </div>
                <ChevronRight className={`w-4 h-4 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} />
              </button>
              {isOpen && (
                <div className="border-t border-border divide-y divide-border">
                  {rows.slice(0, 50).map((r) => (
                    <Link
                      key={r.id}
                      href={`/pipeline/${r.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{r.businessName}</p>
                        <p className="text-xs text-muted truncate">
                          {r.niche}
                          {r.city ? ` · ${r.city}` : ""}
                          {r.rejectionReason ? ` · ${r.rejectionReason}` : ""}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted" />
                    </Link>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
