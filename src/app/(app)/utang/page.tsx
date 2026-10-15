import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, EmptyState, Badge, StatCard } from "@/components/ui";
import { approveAdvance, rejectAdvance } from "./actions";
import { formatPeso } from "@/lib/money";
import { formatDate } from "@/lib/format";
import type { UtangLedgerRow, UtangAgingView, FarmerBalanceView } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function UtangPage() {
  const session = await getSessionProfile();
  const owner = isOwner(session?.profile);
  const supabase = await createClient();

  const [{ data: pending }, { data: aging }, { data: balances }, { data: farmers }] =
    await Promise.all([
      supabase
        .from("utang_ledger")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase.from("v_utang_aging").select("*"),
      supabase.from("v_farmer_balances").select("*").gt("balance_centavos", 0).order("balance_centavos", { ascending: false }),
      supabase.from("farmers").select("id,name"),
    ]);

  const pendingRows = (pending ?? []) as UtangLedgerRow[];
  const agingRows = (aging ?? []) as UtangAgingView[];
  const balanceRows = (balances ?? []) as FarmerBalanceView[];
  const farmerName = new Map(
    ((farmers ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]),
  );

  const totals = agingRows.reduce(
    (acc, r) => ({
      b0: acc.b0 + r.bucket_0_30,
      b1: acc.b1 + r.bucket_31_60,
      b2: acc.b2 + r.bucket_61_90,
      b3: acc.b3 + r.bucket_90_plus,
      total: acc.total + r.total_outstanding,
    }),
    { b0: 0, b1: 0, b2: 0, b3: 0, total: 0 },
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Utang" subtitle="Farmer advances & repayments" />

      <StatCard label="Total utang outstanding" value={formatPeso(totals.total)} />

      {owner && pendingRows.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <h2 className="mb-3 font-semibold text-amber-800">
            Advances awaiting your approval
          </h2>
          <div className="space-y-3">
            {pendingRows.map((r) => (
              <div key={r.id} className="rounded-xl bg-white p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {farmerName.get(r.farmer_id) ?? "Farmer"}
                    </div>
                    <div className="text-xs text-gray-400">
                      {formatDate(r.entry_date)}
                      {r.remarks ? ` · ${r.remarks}` : ""}
                    </div>
                  </div>
                  <div className="font-semibold">{formatPeso(r.amount_centavos)}</div>
                </div>
                <div className="mt-3 flex gap-2">
                  <form action={approveAdvance}>
                    <input type="hidden" name="ledger_id" value={r.id} />
                    <button className="btn-primary px-4 py-2 text-sm">Approve</button>
                  </form>
                  <form action={rejectAdvance} className="flex flex-1 gap-2">
                    <input type="hidden" name="ledger_id" value={r.id} />
                    <input
                      name="reason"
                      placeholder="Reason"
                      className="field-input flex-1 py-2 text-sm"
                    />
                    <button className="btn-secondary px-4 py-2 text-sm">Reject</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-semibold">Aging report</h2>
        <div className="grid grid-cols-4 gap-2 text-center text-sm">
          <div>
            <div className="text-xs text-gray-400">0–30</div>
            <div className="font-semibold">{formatPeso(totals.b0, false)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">31–60</div>
            <div className="font-semibold">{formatPeso(totals.b1, false)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">61–90</div>
            <div className="font-semibold">{formatPeso(totals.b2, false)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">90+</div>
            <div className="font-semibold">{formatPeso(totals.b3, false)}</div>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Farmers with utang</h2>
        {balanceRows.length === 0 ? (
          <EmptyState>No outstanding utang. 🎉</EmptyState>
        ) : (
          <div className="divide-y divide-gray-100">
            {balanceRows.map((f) => (
              <Link
                key={f.farmer_id}
                href={`/farmers/${f.farmer_id}`}
                className="flex items-center justify-between py-2 text-sm active:bg-gray-50"
              >
                <div>
                  <div className="font-medium">{f.name}</div>
                  <div className="text-xs text-gray-400">{f.barangay || "—"}</div>
                </div>
                <Badge tone="amber">{formatPeso(f.balance_centavos)}</Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
