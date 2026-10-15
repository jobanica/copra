"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { pesosToCentavos } from "@/lib/money";
import type { ActionState } from "@/components/ActionForm";

function num(v: FormDataEntryValue | null): number | null {
  if (v === null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function deleteSale(formData: FormData): Promise<void> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return;
  const id = String(formData.get("sale_id") || "");
  if (!id) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_sale", { p_sale_id: id });
  if (error) return;
  revalidatePath("/sales");
  revalidatePath("/", "layout");
  redirect("/sales");
}

export async function postSale(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) {
    return { error: "Only the owner can record sales." };
  }

  const loaded = num(formData.get("our_loaded_kg"));
  if (!loaded || loaded <= 0) return { error: "Loaded kg is required." };

  const priceC = pesosToCentavos(num(formData.get("price_per_kg")) ?? 0);
  const amountC = pesosToCentavos(num(formData.get("amount_received")) ?? 0);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("post_sale", {
    p_buyer_id: (formData.get("buyer_id") as string) || null,
    p_sale_date: (formData.get("sale_date") as string) || null,
    p_plate_no: (formData.get("plate_no") as string) || null,
    p_driver: (formData.get("driver") as string) || null,
    p_our_loaded_kg: loaded,
    p_our_avg_deduction_pct: num(formData.get("our_avg_deduction_pct")) ?? 0,
    p_buyer_gross_kg: num(formData.get("buyer_gross_kg")),
    p_buyer_deduction_pct: num(formData.get("buyer_deduction_pct")),
    p_buyer_net_kg: num(formData.get("buyer_net_kg")),
    p_price_per_kg_centavos: priceC,
    p_amount_received_centavos: amountC,
    p_payment_method: (formData.get("payment_method") as string) || null,
    p_trucking_centavos: pesosToCentavos(num(formData.get("trucking")) ?? 0),
    p_labor_centavos: pesosToCentavos(num(formData.get("labor")) ?? 0),
    p_other_expenses_centavos: pesosToCentavos(num(formData.get("other")) ?? 0),
    p_book_kg: num(formData.get("book_kg")),
    p_remarks: (formData.get("remarks") as string) || null,
  });

  if (error) return { error: error.message };
  const id = (data as { id: string }).id;
  revalidatePath("/sales");
  revalidatePath("/stock");
  revalidatePath("/dashboard");
  redirect(`/sales/${id}`);
}

export async function voidSale(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) {
    return { error: "Only the owner can void sales." };
  }
  const saleId = String(formData.get("sale_id") || "");
  const reason = String(formData.get("reason") || "").trim();
  if (!reason) return { error: "A void reason is required." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_sale", {
    p_sale_id: saleId,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  revalidatePath(`/sales/${saleId}`);
  revalidatePath("/sales");
  revalidatePath("/stock");
  return { message: "Sale voided." };
}

export async function addBuyer(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) {
    return { error: "Only the owner can add buyers." };
  }
  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Buyer name is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("buyers").insert({
    business_id: session.profile.business_id,
    name,
    contact: (formData.get("contact") as string) || null,
    created_by: session.userId,
  });
  if (error) return { error: error.message };
  revalidatePath("/sales");
  return { message: "Buyer added." };
}
