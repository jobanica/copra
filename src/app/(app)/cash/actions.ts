"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { pesosToCentavos, formatPeso } from "@/lib/money";
import type { ActionState } from "@/components/ActionForm";

function peso(v: FormDataEntryValue | null): number {
  return pesosToCentavos(Number(v) || 0);
}

export async function adjustCashBalance(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return { error: "Owner only." };
  const id = String(formData.get("cash_account_id") || "");
  const newBalance = Number(formData.get("new_balance"));
  if (!id) return { error: "Missing account." };
  if (!Number.isFinite(newBalance) || newBalance < 0) {
    return { error: "Enter a valid balance." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_cash_balance", {
    p_cash_account_id: id,
    p_new_balance_centavos: pesosToCentavos(newBalance),
    p_remarks: String(formData.get("remarks") || "") || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/cash");
  revalidatePath("/", "layout");
  return { message: "Cash balance corrected." };
}

export async function deleteExpense(formData: FormData): Promise<void> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return;
  const id = String(formData.get("expense_id") || "");
  if (!id) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_expense", { p_expense_id: id });
  if (error) return;
  revalidatePath("/cash");
  revalidatePath("/", "layout");
}

export async function recordExpense(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." };
  const amount = Number(formData.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a valid amount." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("post_expense", {
    p_expense_account_id: String(formData.get("expense_account_id") || ""),
    p_cash_account_id: String(formData.get("cash_account_id") || ""),
    p_amount_centavos: pesosToCentavos(amount),
    p_expense_date: (formData.get("expense_date") as string) || null,
    p_remarks: (formData.get("remarks") as string) || null,
    p_receipt_photo_url: (formData.get("receipt_photo_url") as string) || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/cash");
  redirect("/cash");
}

export async function recordEquity(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return { error: "Owner only." };
  const type = String(formData.get("type") || "");
  const amount = Number(formData.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a valid amount." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_equity", {
    p_type: type,
    p_amount_centavos: pesosToCentavos(amount),
    p_cash_account_id: (formData.get("cash_account_id") as string) || null,
    p_from_account_id: (formData.get("from_account_id") as string) || null,
    p_to_account_id: (formData.get("to_account_id") as string) || null,
    p_txn_date: (formData.get("txn_date") as string) || null,
    p_remarks: (formData.get("remarks") as string) || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/cash");
  return { message: "Recorded." };
}

export async function openDay(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("open_cash_day", {
    p_business_date: (formData.get("business_date") as string) || null,
    p_opening_float_centavos: peso(formData.get("opening_float")),
  });
  revalidatePath("/cash");
}

export async function recordCount(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_cash_count", {
    p_business_date: (formData.get("business_date") as string) || null,
    p_counted_centavos: peso(formData.get("counted")),
    p_denominations: null,
  });
  if (error) return { error: error.message };
  revalidatePath("/cash");
  const row = data as { expected_centavos: number; variance_centavos: number } | null;
  if (!row) return { message: "Count recorded." };
  return {
    message: `Counted recorded. Expected ${formatPeso(row.expected_centavos)}, variance ${formatPeso(row.variance_centavos)}.`,
  };
}

export async function closeDay(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("close_cash_day", {
    p_business_date: (formData.get("business_date") as string) || null,
  });
  revalidatePath("/cash");
}

export async function voidExpense(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return { error: "Owner only." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_expense", {
    p_expense_id: String(formData.get("expense_id") || ""),
    p_reason: String(formData.get("reason") || "void"),
  });
  if (error) return { error: error.message };
  revalidatePath("/cash");
  return { message: "Expense voided." };
}
