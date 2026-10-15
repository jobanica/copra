"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import type { ActionState } from "@/components/ActionForm";

export async function postStockCount(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) {
    return { error: "Only the owner can record stock counts." };
  }
  const counted = Number(formData.get("counted_kg"));
  if (!Number.isFinite(counted) || counted < 0) {
    return { error: "Enter a valid counted weight." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_stock_count", {
    p_counted_kg: counted,
    p_count_date: (formData.get("count_date") as string) || null,
    p_remarks: (formData.get("remarks") as string) || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/stock");
  revalidatePath("/dashboard");
  return { message: "Stock count recorded." };
}
