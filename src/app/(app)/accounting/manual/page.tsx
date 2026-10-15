import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ManualJournalForm } from "@/components/ManualJournalForm";
import { manilaToday } from "@/lib/format";
import type { GlAccount } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function ManualJournalPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isOwner(session.profile)) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("gl_accounts")
    .select("id,code,name")
    .eq("active", true)
    .order("sort_order");
  const accounts = (data ?? []) as Pick<GlAccount, "id" | "code" | "name">[];

  return (
    <div className="space-y-4">
      <PageHeader title="Manual journal entry" subtitle="Owner only · must balance" />
      <ManualJournalForm accounts={accounts} today={manilaToday()} />
    </div>
  );
}
