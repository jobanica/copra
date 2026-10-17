"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { pesosToCentavos } from "@/lib/money";
import type { ActionState } from "@/components/ActionForm";

export async function createPayable(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return { error: "Owner only." };

  const payee = String(formData.get("payee") || "").trim();
  const amount = Number(formData.get("amount"));
  if (!payee) return { error: "Who is it payable to?" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a valid amount." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_payable", {
    p_payee: payee,
    p_amount_centavos: pesosToCentavos(amount),
    p_incurred_date: String(formData.get("incurred_date") || "") || null,
    p_due_date: String(formData.get("due_date") || "") || null,
    p_offset_account_id: String(formData.get("offset_account_id") || "") || null,
    p_category: String(formData.get("category") || "") || null,
    p_remarks: String(formData.get("remarks") || "") || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/payables");
  revalidatePath("/", "layout");
  return { message: "Payable recorded." };
}

export async function payPayable(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return { error: "Owner only." };

  const amount = Number(formData.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a valid amount." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payable_payment", {
    p_payable_id: String(formData.get("payable_id") || ""),
    p_amount_centavos: pesosToCentavos(amount),
    p_cash_account_id: String(formData.get("cash_account_id") || ""),
    p_paid_date: String(formData.get("paid_date") || "") || null,
    p_remarks: String(formData.get("remarks") || "") || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/payables");
  revalidatePath("/", "layout");
  return { message: "Payment recorded." };
}

export async function voidPayable(formData: FormData): Promise<void> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return;
  const supabase = await createClient();
  await supabase.rpc("void_payable", {
    p_payable_id: String(formData.get("payable_id") || ""),
  });
  revalidatePath("/payables");
  revalidatePath("/", "layout");
}
