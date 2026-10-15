"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { countPending } from "@/lib/offline/db";
import { syncPending } from "@/lib/offline/sync";

export function OfflineIndicator() {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setPending(await countPending());
    } catch {
      /* IndexedDB unavailable */
    }
  }, []);

  const runSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await syncPending();
      if (result.synced > 0) router.refresh();
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh, router, syncing]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refresh();

    const onOnline = () => {
      setOnline(true);
      void runSync();
    };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void runSync();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("copra:queued", refresh);
    document.addEventListener("visibilitychange", onVisible);

    if (navigator.onLine) void runSync();
    const interval = setInterval(() => {
      void refresh();
      if (navigator.onLine) void runSync();
    }, 20000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("copra:queued", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (online && pending === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-700">
        ● Online
      </span>
    );
  }

  if (pending > 0) {
    return (
      <Link
        href="/purchases/pending"
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800"
      >
        {syncing ? "Syncing…" : `${pending} unsynced`}
      </Link>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
      ● Offline
    </span>
  );
}
