"use client";

import { useEffect, useState, useCallback } from "react";
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
    setSyncing(true);
    try {
      const result = await syncPending();
      if (result.synced > 0) router.refresh();
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh, router]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refresh();

    const onOnline = () => {
      setOnline(true);
      void runSync();
    };
    const onOffline = () => setOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // Also listen for queue changes dispatched by the purchase form.
    window.addEventListener("copra:queued", refresh);

    // Attempt a sync on mount in case items are queued.
    if (navigator.onLine) void runSync();

    const interval = setInterval(refresh, 15000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("copra:queued", refresh);
      clearInterval(interval);
    };
  }, [refresh, runSync]);

  if (online && pending === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-700">
        ● Online
      </span>
    );
  }

  if (!online) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
        ● Offline{pending > 0 ? ` · ${pending} unsynced` : ""}
      </span>
    );
  }

  // online with pending items
  return (
    <button
      onClick={runSync}
      className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800"
    >
      {syncing ? "Syncing…" : `${pending} unsynced · tap to sync`}
    </button>
  );
}
