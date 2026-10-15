import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/db";

export interface SessionProfile {
  userId: string;
  email: string | null;
  profile: Profile;
}

/** Returns the signed-in user's profile, or null if not authenticated. */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!data) return null;

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: data as Profile,
  };
}

export function isOwner(profile: Profile | null | undefined): boolean {
  return profile?.role === "owner";
}
