import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, LinkButton, Badge } from "@/components/ui";
import { formatPeso } from "@/lib/money";
import { formatKg } from "@/lib/weight";
import { formatDateTime } from "@/lib/format";
import type { Purchase, Farmer } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function PurchasesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchases")
    .select("*")
    .order("purchased_at", { ascending: false })
    .limit(60);
  const purchases = (data ?? []) as Purchase[];

  const farmerIds = [...new Set(purchases.map((p) => p.farmer_id))];
  const { data: farmers } = farmerIds.length
    ? await supabase.from("farmers").select("id,name").in("id", farmerIds)
    : { data: [] };
  const names = new Map(
    ((farmers ?? []) as Pick<Farmer, "id" | "name">[]).map((f) => [f.id, f.name]),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchases"
        action={<LinkButton href="/purchases/new">+ Buy</LinkButton>}
      />
      {purchases.length === 0 ? (
        <EmptyState>No purchases yet. Tap “Buy” to record one.</EmptyState>
      ) : (
        <Card className="p-0">
          <div className="divide-y divide-gray-100">
            {purchases.map((p) => (
              <Link
                key={p.id}
                href={`/purchases/${p.id}`}
                className="flex items-center justify-between px-4 py-3 active:bg-gray-50"
              >
                <div>
                  <div className="font-medium">
                    #{p.receipt_no} · {names.get(p.farmer_id) ?? "Farmer"}
                    {p.status === "voided" && (
                      <span className="ml-2">
                        <Badge tone="red">voided</Badge>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">
                    {formatDateTime(p.purchased_at)} · {formatKg(p.net_kg)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{formatPeso(p.gross_amount_centavos)}</div>
                  <div className="text-xs text-gray-400">
                    cash {formatPeso(p.cash_paid_centavos)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
