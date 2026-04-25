"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface AuthCtx {
  token: string | null;
  setToken: (t: string | null) => void;
  loading: boolean;
}

const AuthContext = createContext<AuthCtx>({ token: null, setToken: () => {}, loading: true });

const TOKEN_KEY = "super-engine-token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      if (t) setTokenState(t);
    } catch {}
    setLoading(false);
  }, []);

  const setToken = (t: string | null) => {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
    setTokenState(t);
  };

  const value = useMemo(() => ({ token, setToken, loading }), [token, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
