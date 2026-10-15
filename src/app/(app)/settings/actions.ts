"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { pesosToCentavos } from "@/lib/money";
import type { ActionState } from "@/components/ActionForm";

export async function updateSettings(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return { error: "Owner only." };

  const shrink = Number(formData.get("shrinkage_threshold_pct"));
  const limit = Number(formData.get("advance_approval_limit"));
  if (!Number.isFinite(shrink) || shrink < 0 || shrink > 100) {
    return { error: "Shrinkage threshold must be 0–100%." };
  }
  if (!Number.isFinite(limit) || limit < 0) {
    return { error: "Approval limit must be 0 or more." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("business_settings")
    .update({
      shrinkage_threshold_pct: shrink,
      advance_approval_limit_centavos: pesosToCentavos(limit),
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", session.profile.business_id);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { message: "Settings saved." };
}

export async function updateBusiness(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return { error: "Owner only." };
  const name = String(formData.get("name") || "").trim();
  const address = String(formData.get("address") || "").trim();
  if (!name) return { error: "Business name is required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .update({ name, address: address || null })
    .eq("id", session.profile.business_id);
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { message: "Business details saved." };
}

export async function clearTransactions(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return { error: "Owner only." };

  const confirm = String(formData.get("confirm") || "").trim();
  if (confirm !== "DELETE") {
    return { error: 'Type DELETE (in capitals) to confirm.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("reset_business_transactions");
  if (error) return { error: error.message };

  // Everything derived from transactions changes — refresh the whole app.
  revalidatePath("/", "layout");
  return {
    message:
      "All transactions cleared. Receipt numbering restarts at #1 and stock is zeroed. Farmers, prices and settings were kept.",
  };
}

export async function addGrade(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) return { error: "Owner only." };
  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Grade name is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("grades").insert({
    business_id: session.profile.business_id,
    name,
  });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  revalidatePath("/prices");
  return { message: "Grade added." };
}
