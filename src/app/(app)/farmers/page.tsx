import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, LinkButton } from "@/components/ui";
import { FarmersList } from "@/components/FarmersList";
import type { FarmerBalanceView } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function FarmersPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("v_farmer_balances").select("*").order("name");
  const farmers = (data ?? []) as FarmerBalanceView[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Farmers"
        action={<LinkButton href="/farmers/new">+ New</LinkButton>}
      />

      {farmers.length === 0 ? (
        <EmptyState>No farmers yet. Add your first one.</EmptyState>
      ) : (
        <FarmersList farmers={farmers} />
      )}
    </div>
  );
}
