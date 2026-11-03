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
    supabase.from("inventory_state").select("*"),
    supabase
      .from("buyer_reference_prices")
      .select("*")
      .order("effective_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const states = (inv ?? []) as InventoryState[];
  const stockByProduct: Record<string, { qty: number; avgCost: number }> = {
    copra: { qty: 0, avgCost: 0 },
    charcoal: { qty: 0, avgCost: 0 },
  };
  for (const s of states) {
    stockByProduct[s.product] = {
      qty: s.qty_on_hand_kg,
      avgCost: s.avg_cost_centavos,
    };
  }
  const anyStock = states.some((s) => s.qty_on_hand_kg > 0);
  const bp = buyerPrice as BuyerReferencePrice | null;

  return (
    <div className="space-y-4">
      <PageHeader title="Record sale" subtitle="Truckload to a trader" />
      {!anyStock ? (
        <Card className="border-amber-300 bg-amber-50">
          <div className="font-semibold text-amber-800">No stock on hand.</div>
          <p className="mt-1 text-sm text-amber-700">
            Record purchases first — there is nothing to sell yet.
          </p>
        </Card>
      ) : (
        <SaleForm
          buyers={(buyers ?? []) as Buyer[]}
          stockByProduct={stockByProduct}
          today={manilaToday()}
          defaultBuyerPricePesos={bp ? bp.price_per_kg_centavos / 100 : 0}
        />
      )}
    </div>
  );
}
