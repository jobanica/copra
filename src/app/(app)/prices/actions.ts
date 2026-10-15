"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { pesosToCentavos } from "@/lib/money";
import type { ActionState } from "@/components/ActionForm";

export async function setBuyingPrice(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) {
    return { error: "Only the owner can set prices." };
  }

  const effectiveDate = String(formData.get("effective_date") || "");
  const gradeRaw = String(formData.get("grade_id") || "");
  const gradeId = gradeRaw === "" ? null : gradeRaw;
  const priceNum = Number(formData.get("price_per_kg"));
  if (!effectiveDate || !Number.isFinite(priceNum) || priceNum < 0) {
    return { error: "Enter a valid date and price." };
  }
  const centavos = pesosToCentavos(priceNum);
  const supabase = await createClient();
  const businessId = session.profile.business_id;

  // Upsert (unique on date + grade). The grade part is an expression index,
  // so we check-then-write rather than ON CONFLICT.
  let query = supabase
    .from("buying_prices")
    .select("id")
    .eq("business_id", businessId)
    .eq("effective_date", effectiveDate);
  query = gradeId === null ? query.is("grade_id", null) : query.eq("grade_id", gradeId);
  const { data: existing } = await query.maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("buying_prices")
      .update({ price_per_kg_centavos: centavos, set_by: session.userId })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("buying_prices").insert({
      business_id: businessId,
      effective_date: effectiveDate,
      grade_id: gradeId,
      price_per_kg_centavos: centavos,
      set_by: session.userId,
    });
    if (error) return { error: error.message };
  }

  revalidatePath("/prices");
  revalidatePath("/dashboard");
  return { message: "Buying price saved." };
}

export async function setBuyerPrice(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) {
    return { error: "Only the owner can set prices." };
  }
  const effectiveDate = String(formData.get("effective_date") || "");
  const priceNum = Number(formData.get("buyer_price_per_kg"));
  if (!effectiveDate || !Number.isFinite(priceNum) || priceNum < 0) {
    return { error: "Enter a valid date and price." };
  }
  const centavos = pesosToCentavos(priceNum);
  const supabase = await createClient();
  const businessId = session.profile.business_id;

  const { data: existing } = await supabase
    .from("buyer_reference_prices")
    .select("id")
    .eq("business_id", businessId)
    .eq("effective_date", effectiveDate)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("buyer_reference_prices")
      .update({ price_per_kg_centavos: centavos, set_by: session.userId })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("buyer_reference_prices").insert({
      business_id: businessId,
      effective_date: effectiveDate,
      price_per_kg_centavos: centavos,
      set_by: session.userId,
    });
    if (error) return { error: error.message };
  }

  revalidatePath("/prices");
  revalidatePath("/dashboard");
  return { message: "Buyer reference price saved." };
}
