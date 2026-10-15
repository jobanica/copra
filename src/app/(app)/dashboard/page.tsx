import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { StatCard, PageHeader, Card } from "@/components/ui";
import { formatPeso } from "@/lib/money";
import { formatKg } from "@/lib/weight";
import { manilaToday } from "@/lib/format";
import type { DashboardTodayView, BuyingPrice, BuyerReferencePrice } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSessionProfile();
  const isOwner = session?.profile.role === "owner";
  const supabase = await createClient();
  const today = manilaToday();

  const [{ data: dash }, { data: price }, { data: buyerPrice }] = await Promise.all([
    supabase.from("v_dashboard_today").select("*").maybeSingle(),
    supabase
      .from("buying_prices")
      .select("*")
      .eq("effective_date", today)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("buyer_reference_prices")
      .select("*")
      .eq("effective_date", today)
      .maybeSingle(),
  ]);

  const d = (dash ?? null) as DashboardTodayView | null;
  const p = (price ?? null) as BuyingPrice | null;
  const bp = (buyerPrice ?? null) as BuyerReferencePrice | null;
  const marginPerKg =
    p && bp ? bp.price_per_kg_centavos - p.price_per_kg_centavos : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Hello${session?.profile.full_name ? ", " + session.profile.full_name.split(" ")[0] : ""} 👋`}
        subtitle="Today at the buying station"
      />

      {!p && (
        <Card className="border-amber-300 bg-amber-50">
          <div className="font-semibold text-amber-800">
            Today&apos;s buying price is not set.
          </div>
          <p className="mt-1 text-sm text-amber-700">
            {isOwner
              ? "Cashiers cannot record purchases until you set today's price."
              : "Ask the owner to set today's price before recording purchases."}
          </p>
          {isOwner && (
            <Link href="/prices" className="btn-primary mt-3 inline-flex">
              Set today&apos;s price
            </Link>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Kg bought today" value={formatKg(d?.today_net_kg ?? 0)} />
        <StatCard
          label="Purchases today"
          value={String(d?.today_purchase_count ?? 0)}
        />
        <StatCard
          label="Cash paid out today"
          value={formatPeso(d?.today_cash_out_centavos ?? 0)}
        />
        <StatCard
          label="Buying price / kg"
          value={p ? formatPeso(p.price_per_kg_centavos) : "—"}
        />
      </div>

      {isOwner && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Total utang out"
            value={formatPeso(d?.total_utang_outstanding_centavos ?? 0)}
          />
          <StatCard
            label="Margin / kg"
            value={marginPerKg !== null ? formatPeso(marginPerKg) : "—"}
            hint={
              bp ? `Buyer price ${formatPeso(bp.price_per_kg_centavos)}/kg` : "Set buyer price"
            }
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        <Link href="/purchases/new" className="btn-primary py-5 text-lg">
          ⚖️ Record a purchase
        </Link>
      </div>
    </div>
  );
}
