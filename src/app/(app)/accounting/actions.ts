"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { pesosToCentavos } from "@/lib/money";
import type { ActionState } from "@/components/ActionForm";

export async function closePeriod(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("close_period", {
    p_year: Number(formData.get("year")),
    p_month: Number(formData.get("month")),
  });
  revalidatePath("/accounting");
}

export async function reopenPeriod(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("reopen_period", {
    p_year: Number(formData.get("year")),
    p_month: Number(formData.get("month")),
  });
  revalidatePath("/accounting");
}

export async function addAccount(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return { error: "Owner only." };
  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const type = String(formData.get("type") || "");
  if (!code || !name) return { error: "Code and name are required." };
  const normal =
    type === "asset" || type === "expense" ? "debit" : "credit";

  const supabase = await createClient();
  const { error } = await supabase.from("gl_accounts").insert({
    business_id: session.profile.business_id,
    code,
    name,
    type,
    normal_balance: normal,
  });
  if (error) return { error: error.message };
  revalidatePath("/accounting/chart");
  return { message: "Account added." };
}

export async function createManualJournal(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return { error: "Owner only." };

  const entryDate = (formData.get("entry_date") as string) || null;
  const memo = (formData.get("memo") as string) || null;
  let parsed: { account_id: string; side: "debit" | "credit"; amount: number }[];
  try {
    parsed = JSON.parse(String(formData.get("lines") || "[]"));
  } catch {
    return { error: "Invalid lines." };
  }
  const lines = parsed
    .filter((l) => l.account_id && l.amount > 0)
    .map((l) => ({
      account_id: l.account_id,
      ...(l.side === "debit"
        ? { debit: pesosToCentavos(l.amount) }
        : { credit: pesosToCentavos(l.amount) }),
    }));
  if (lines.length < 2) return { error: "Enter at least two lines." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_manual_journal", {
    p_entry_date: entryDate,
    p_memo: memo,
    p_lines: lines,
  });
  if (error) return { error: error.message };
  revalidatePath("/accounting/journal");
  redirect(`/accounting/journal/${(data as { id: string }).id}`);
}
