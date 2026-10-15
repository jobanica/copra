"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import type { ActionState } from "@/components/ActionForm";

export async function voidPurchase(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) {
    return { error: "Only the owner can void purchases." };
  }
  const purchaseId = String(formData.get("purchase_id") || "");
  const reason = String(formData.get("reason") || "").trim();
  if (!purchaseId) return { error: "Missing purchase." };
  if (!reason) return { error: "A void reason is required." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_purchase", {
    p_purchase_id: purchaseId,
    p_reason: reason,
  });
  if (error) return { error: error.message };

  revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/purchases");
  return { message: "Purchase voided." };
}
