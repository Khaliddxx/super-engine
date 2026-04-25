"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Inbox, Workflow, LayoutDashboard, Settings, Sparkles } from "lucide-react";
import { useAuth } from "../../components/AuthProvider";

const tabs = [
  { href: "/queue", label: "Queue", icon: Inbox },
  { href: "/markets", label: "Markets", icon: Sparkles },
  { href: "/pipeline", label: "Pipeline", icon: Workflow },
  { href: "/dashboard", label: "Dash", icon: LayoutDashboard },
  { href: "/controls", label: "Controls", icon: Settings },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !token) router.replace("/login");
  }, [token, loading, router]);

  if (loading || !token) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 pb-20">{children}</main>
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur border-t border-border safe-bottom">
        <div className="flex max-w-xl mx-auto">
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link key={href} href={href} className={`tabbar-btn ${active ? "active" : ""}`}>
                <Icon className="w-5 h-5" />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
