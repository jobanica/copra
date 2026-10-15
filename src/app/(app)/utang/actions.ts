"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { pesosToCentavos } from "@/lib/money";
import type { ActionState } from "@/components/ActionForm";

export async function createAdvance(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." };

  const farmerId = String(formData.get("farmer_id") || "");
  const amount = Number(formData.get("amount"));
  const remarks = String(formData.get("remarks") || "") || null;
  if (!farmerId || !Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter a valid amount." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_advance", {
    p_farmer_id: farmerId,
    p_amount_centavos: pesosToCentavos(amount),
    p_remarks: remarks,
  });
  if (error) return { error: error.message };

  revalidatePath(`/farmers/${farmerId}`);
  revalidatePath("/utang");
  const status = (data as { status?: string } | null)?.status;
  return {
    message:
      status === "pending"
        ? "Advance recorded — waiting for owner approval."
        : "Advance recorded.",
  };
}

export async function recordRepayment(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." };

  const farmerId = String(formData.get("farmer_id") || "");
  const amount = Number(formData.get("amount"));
  const remarks = String(formData.get("remarks") || "") || null;
  if (!farmerId || !Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter a valid amount." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_cash_repayment", {
    p_farmer_id: farmerId,
    p_amount_centavos: pesosToCentavos(amount),
    p_remarks: remarks,
  });
  if (error) return { error: error.message };

  revalidatePath(`/farmers/${farmerId}`);
  revalidatePath("/utang");
  return { message: "Repayment recorded." };
}

export async function approveAdvance(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("approve_advance", {
    p_ledger_id: String(formData.get("ledger_id") || ""),
  });
  revalidatePath("/utang");
}

export async function rejectAdvance(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("reject_advance", {
    p_ledger_id: String(formData.get("ledger_id") || ""),
    p_reason: String(formData.get("reason") || "") || null,
  });
  revalidatePath("/utang");
}
