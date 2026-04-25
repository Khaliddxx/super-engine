"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/AuthProvider";

export default function Home() {
  const router = useRouter();
  const { token, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    if (!token) router.replace("/login");
    else router.replace("/queue");
  }, [token, loading, router]);
  return null;
}
