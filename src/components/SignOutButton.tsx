"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700"
    >
      Sign out
    </button>
  );
}
