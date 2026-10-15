"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface PurchasePayload {
  p_farmer_id: string;
  p_grade_id: string | null;
  p_purchased_at: string;
  p_sack_count: number;
  p_gross_kg: number;
  p_tare_kg: number;
  p_deduction_kg: number;
  p_deduction_pct: number;
  p_price_per_kg_centavos: number;
  p_utang_deducted_centavos: number;
  p_remarks: string | null;
  p_scale_photo_url: string | null;
  p_client_uuid: string;
}

export interface PendingPurchase {
  client_uuid: string;
  farmer_name: string;
  payload: PurchasePayload;
  created_at: string;
  error?: string;
}

interface CopraDB extends DBSchema {
  pending_purchases: {
    key: string;
    value: PendingPurchase;
  };
}

let dbPromise: Promise<IDBPDatabase<CopraDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<CopraDB>("coprabooks", 1, {
      upgrade(db) {
        db.createObjectStore("pending_purchases", { keyPath: "client_uuid" });
      },
    });
  }
  return dbPromise;
}

export async function enqueuePurchase(item: PendingPurchase): Promise<void> {
  const db = await getDB();
  await db.put("pending_purchases", item);
}

export async function listPending(): Promise<PendingPurchase[]> {
  const db = await getDB();
  return db.getAll("pending_purchases");
}

export async function countPending(): Promise<number> {
  const db = await getDB();
  return db.count("pending_purchases");
}

export async function removePending(clientUuid: string): Promise<void> {
  const db = await getDB();
  await db.delete("pending_purchases", clientUuid);
}

export async function setPendingError(
  clientUuid: string,
  error: string,
): Promise<void> {
  const db = await getDB();
  const item = await db.get("pending_purchases", clientUuid);
  if (item) {
    item.error = error;
    await db.put("pending_purchases", item);
  }
}
