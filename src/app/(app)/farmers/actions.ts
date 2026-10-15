"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { farmerSchema } from "@/lib/validation";
import type { ActionState } from "@/components/ActionForm";

export async function createFarmer(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." };

  const parsed = farmerSchema.safeParse({
    name: formData.get("name"),
    barangay: formData.get("barangay"),
    mobile: formData.get("mobile"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("farmers")
    .insert({
      business_id: session.profile.business_id,
      name: parsed.data.name,
      barangay: parsed.data.barangay || null,
      mobile: parsed.data.mobile || null,
      notes: parsed.data.notes || null,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/farmers");
  redirect(`/farmers/${data.id}`);
}

export async function updateFarmer(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." };
  const id = String(formData.get("farmer_id") || "");
  const parsed = farmerSchema.safeParse({
    name: formData.get("name"),
    barangay: formData.get("barangay"),
    mobile: formData.get("mobile"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("farmers")
    .update({
      name: parsed.data.name,
      barangay: parsed.data.barangay || null,
      mobile: parsed.data.mobile || null,
      notes: parsed.data.notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/farmers/${id}`);
  return { message: "Farmer updated." };
}
