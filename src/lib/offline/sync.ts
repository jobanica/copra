"use client";

import { createClient } from "@/lib/supabase/client";
import { listPending, removePending, setPendingError } from "./db";

export interface SyncResult {
  synced: number;
  failed: number;
}

/**
 * Push every queued purchase to the server. Network errors keep the item
 * queued for the next attempt; validation/business errors (e.g. a stale
 * price) are recorded against the item so the cashier can see why.
 */
export async function syncPending(): Promise<SyncResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { synced: 0, failed: 0 };
  }

  const supabase = createClient();
  const pending = await listPending();
  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    const { error } = await supabase.rpc("post_purchase", item.payload);
    if (!error) {
      await removePending(item.client_uuid);
      synced++;
      continue;
    }

    // Distinguish network failures (retry) from business errors (stop retrying).
    const message = error.message ?? "Unknown error";
    const isNetwork =
      message.toLowerCase().includes("fetch") ||
      message.toLowerCase().includes("network");
    if (isNetwork) {
      // leave queued for next time
      continue;
    }
    await setPendingError(item.client_uuid, message);
    failed++;
  }

  return { synced, failed };
}
