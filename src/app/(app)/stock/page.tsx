import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, StatCard, Field, Input, Select, EmptyState } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { postStockCount } from "./actions";
import { formatPeso } from "@/lib/money";
import { formatKg } from "@/lib/weight";
import { formatDate, formatDateTime, manilaToday } from "@/lib/format";
import type { InventoryState, InventoryMovement, StockCount } from "@/types/db";
import { PRODUCTS } from "@/types/db";

export const dynamic = "force-dynamic";

const MOVE_LABEL: Record<string, string> = {
  purchase_in: "Purchase in",
  purchase_void: "Purchase void",
  sale_out: "Sale out",
  shrinkage: "Shrinkage",
  count_adj: "Count adjustment",
  sale_void: "Sale void",
};
const PRODUCT_LABEL: Record<string, string> = {
  copra: "Copra",
  charcoal: "Charcoal (Uling)",
};

export default async function StockPage() {
  const session = await getSessionProfile();
  const owner = isOwner(session?.profile);
  const supabase = await createClient();

  const { data: invData } = await supabase.from("inventory_state").select("*");
  const states = (invData ?? []) as InventoryState[];
  const stateFor = (pr: string) => states.find((s) => s.product === pr) ?? null;

  let movements: InventoryMovement[] = [];
  let counts: StockCount[] = [];
  if (owner) {
    const [{ data: mv }, { data: sc }] = await Promise.all([
      supabase.from("inventory_movements").select("*").order("occurred_at", { ascending: false }).limit(25),
      supabase.from("stock_counts").select("*").order("count_date", { ascending: false }).limit(10),
    ]);
    movements = (mv ?? []) as InventoryMovement[];
    counts = (sc ?? []) as StockCount[];
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Stock" subtitle="Bodega inventory (weighted average cost)" />

      {PRODUCTS.map((pr) => {
        const st = stateFor(pr.value);
        const qty = st?.qty_on_hand_kg ?? 0;
        const value = st?.total_value_centavos ?? 0;
        const avg = st?.avg_cost_centavos ?? 0;
        return (
          <Card key={pr.value} className="space-y-3">
            <h2 className="font-semibold">{pr.label}</h2>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="On hand" value={formatKg(qty)} />
              <StatCard label="Value at cost" value={formatPeso(value)} />
              <StatCard label="Avg cost / kg" value={formatPeso(Math.round(avg))} />
            </div>
          </Card>
        );
      })}

      {owner && (
        <Card>
          <h2 className="mb-3 font-semibold">Physical stock count</h2>
          <p className="mb-3 text-sm text-gray-500">
            Enter the actual counted weight for a product. The difference versus
            book is posted as an adjustment at that product&apos;s average cost.
          </p>
          <ActionForm action={postStockCount} className="space-y-3">
            <Field label="Product">
              <Select name="product" defaultValue="copra">
                {PRODUCTS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Counted kg">
                <Input type="number" step="0.01" min="0" inputMode="decimal" name="counted_kg" required />
              </Field>
              <Field label="Date">
                <Input type="date" name="count_date" defaultValue={manilaToday()} />
              </Field>
            </div>
            <Field label="Remarks">
              <Input name="remarks" />
            </Field>
            <SubmitButton variant="secondary">Record count</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {owner && counts.length > 0 && (
        <Card>
          <h2 className="mb-3 font-semibold">Recent counts</h2>
          <div className="divide-y divide-gray-100">
            {counts.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">
                    {formatDate(c.count_date)}
                    <span className="ml-2 text-xs text-gray-400">{PRODUCT_LABEL[c.product] ?? c.product}</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    book {formatKg(c.book_kg, false)} → counted {formatKg(c.counted_kg, false)}
                  </div>
                </div>
                <div className={c.variance_kg < 0 ? "text-red-600" : "text-brand-700"}>
                  {c.variance_kg >= 0 ? "+" : ""}
                  {formatKg(c.variance_kg)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {owner && (
        <Card>
          <h2 className="mb-3 font-semibold">Recent movements</h2>
          {movements.length === 0 ? (
            <EmptyState>No movements yet.</EmptyState>
          ) : (
            <div className="divide-y divide-gray-100">
              {movements.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">
                      {MOVE_LABEL[m.movement_type] ?? m.movement_type}
                      <span className="ml-2 text-xs text-gray-400">{PRODUCT_LABEL[m.product] ?? m.product}</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {formatDateTime(m.occurred_at)} · bal {formatKg(m.balance_qty_after, false)} kg
                    </div>
                  </div>
                  <div className={m.qty_kg < 0 ? "text-red-600" : "text-brand-700"}>
                    {m.qty_kg >= 0 ? "+" : ""}
                    {formatKg(m.qty_kg)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
