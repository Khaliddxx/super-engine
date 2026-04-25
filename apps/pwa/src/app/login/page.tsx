"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../components/AuthProvider";
import { api } from "../../lib/api";

export default function LoginPage() {
  const { setToken } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ token: string }>("/api/auth/login", { method: "POST", body: { password } });
      setToken(res.token);
      router.replace("/queue");
    } catch {
      toast.error("Wrong password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center">
            <Zap className="w-7 h-7 text-accent" />
          </div>
          <h1 className="text-2xl font-serif">Super Engine</h1>
          <p className="text-muted text-sm">Operator access</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input
            className="input"
            type="password"
            autoFocus
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={busy || !password} className="btn-primary w-full disabled:opacity-50">
            {busy ? "Signing in…" : "Enter"}
          </button>
        </form>
      </div>
    </main>
  );
}
