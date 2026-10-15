"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui";
import { listPending, removePending, type PendingPurchase } from "@/lib/offline/db";
import { syncPending } from "@/lib/offline/sync";
import { formatPeso } from "@/lib/money";
import { formatKg } from "@/lib/weight";
import { formatDateTime } from "@/lib/format";

export default function PendingPurchasesPage() {
  const router = useRouter();
  const [items, setItems] = useState<PendingPurchase[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems(await listPending());
    } catch {
      /* ignore */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function sync() {
    setSyncing(true);
    try {
      await syncPending();
      router.refresh();
    } finally {
      setSyncing(false);
      await refresh();
    }
  }

  async function remove(uuid: string) {
    await removePending(uuid);
    await refresh();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Unsynced purchases"
        subtitle="Saved on this device, waiting to reach the server"
        action={
          items.length > 0 ? (
            <button onClick={sync} disabled={syncing} className="btn-primary">
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          ) : undefined
        }
      />

      {!loaded ? null : items.length === 0 ? (
        <EmptyState>Everything is synced. 🎉</EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <Card key={it.client_uuid}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{it.farmer_name}</div>
                  <div className="text-xs text-gray-400">
                    {formatDateTime(it.created_at)} · {formatKg(it.payload.p_gross_kg)} gross
                  </div>
                  <div className="mt-1 text-sm">
                    Price {formatPeso(it.payload.p_price_per_kg_centavos)}/kg
                    {it.payload.p_utang_deducted_centavos > 0 &&
                      ` · utang ${formatPeso(it.payload.p_utang_deducted_centavos)}`}
                  </div>
                </div>
                {it.error ? <Badge tone="red">failed</Badge> : <Badge tone="amber">queued</Badge>}
              </div>
              {it.error && (
                <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {it.error} — this purchase could not be synced. Remove it and
                  record it again.
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button onClick={sync} disabled={syncing} className="btn-secondary px-3 py-2 text-sm">
                  Retry
                </button>
                <button onClick={() => remove(it.client_uuid)} className="btn-danger px-3 py-2 text-sm">
                  Remove
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
