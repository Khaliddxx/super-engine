"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useState, type ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Keep cached data fresh-feeling while still refetching in the background.
            staleTime: 10_000,
            // Stale data stays in the cache for a long time so back-nav is instant.
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            // The PWA loses tabs to backgrounding all the time; refetching on
            // reconnect keeps things in sync without the user pulling-to-refresh.
            refetchOnReconnect: true,
            retry: 1,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>{children}</AuthProvider>
      <Toaster theme="dark" position="top-center" />
    </QueryClientProvider>
  );
}
