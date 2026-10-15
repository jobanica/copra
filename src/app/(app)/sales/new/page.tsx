import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { SaleForm } from "@/components/SaleForm";
import { manilaToday } from "@/lib/format";
import type { Buyer, InventoryState, BuyerReferencePrice } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function NewSalePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isOwner(session.profile)) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: buyers }, { data: inv }, { data: buyerPrice }] = await Promise.all([
    supabase.from("buyers").select("id,name").eq("active", true).order("name"),
    supabase.from("inventory_state").select("*").maybeSingle(),
    supabase
      .from("buyer_reference_prices")
      .select("*")
      .order("effective_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const state = inv as InventoryState | null;
  const bp = buyerPrice as BuyerReferencePrice | null;

  return (
    <div className="space-y-4">
      <PageHeader title="Record sale" subtitle="Truckload to a trader" />
      {!state || state.qty_on_hand_kg <= 0 ? (
        <Card className="border-amber-300 bg-amber-50">
          <div className="font-semibold text-amber-800">No stock on hand.</div>
          <p className="mt-1 text-sm text-amber-700">
            Record purchases first — there is nothing to sell yet.
          </p>
        </Card>
      ) : (
        <SaleForm
          buyers={(buyers ?? []) as Buyer[]}
          stockOnHandKg={state.qty_on_hand_kg}
          avgCostCentavos={Math.round(state.avg_cost_centavos)}
          today={manilaToday()}
          defaultBuyerPricePesos={bp ? bp.price_per_kg_centavos / 100 : 0}
        />
      )}
    </div>
  );
}
