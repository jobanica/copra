import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, Field, Input, Select, EmptyState } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { setBuyingPrice, setBuyerPrice } from "./actions";
import { formatPeso } from "@/lib/money";
import { formatDate, manilaToday } from "@/lib/format";
import type { BuyingPrice, BuyerReferencePrice, Grade } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function PricesPage() {
  const session = await getSessionProfile();
  const owner = isOwner(session?.profile);
  const supabase = await createClient();
  const today = manilaToday();

  const [{ data: grades }, { data: prices }, { data: buyerPrices }] =
    await Promise.all([
      supabase.from("grades").select("*").eq("active", true).order("name"),
      supabase
        .from("buying_prices")
        .select("*")
        .order("effective_date", { ascending: false })
        .limit(30),
      supabase
        .from("buyer_reference_prices")
        .select("*")
        .order("effective_date", { ascending: false })
        .limit(30),
    ]);

  const gradeList = (grades ?? []) as Grade[];
  const priceList = (prices ?? []) as BuyingPrice[];
  const buyerList = (buyerPrices ?? []) as BuyerReferencePrice[];
  const gradeName = (id: string | null) =>
    id ? gradeList.find((g) => g.id === id)?.name ?? "—" : "All / ungraded";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Buying price"
        subtitle="Today's price must be set before cashiers can record purchases."
      />

      {owner ? (
        <>
          <Card>
            <h2 className="mb-3 font-semibold">Set buying price</h2>
            <ActionForm action={setBuyingPrice} className="space-y-3">
              <Field label="Date">
                <Input type="date" name="effective_date" defaultValue={today} required />
              </Field>
              {gradeList.length > 0 && (
                <Field label="Grade">
                  <Select name="grade_id" defaultValue="">
                    <option value="">All / ungraded</option>
                    {gradeList.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Price per kg (₱)">
                <Input
                  type="number"
                  name="price_per_kg"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  required
                />
              </Field>
              <SubmitButton>Save buying price</SubmitButton>
            </ActionForm>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Buyer&apos;s price (for margin)</h2>
            <ActionForm action={setBuyerPrice} className="space-y-3">
              <Field label="Date">
                <Input type="date" name="effective_date" defaultValue={today} required />
              </Field>
              <Field label="Buyer price per kg (₱)" hint="What the trader currently pays us per kg.">
                <Input
                  type="number"
                  name="buyer_price_per_kg"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  required
                />
              </Field>
              <SubmitButton variant="secondary">Save buyer price</SubmitButton>
            </ActionForm>
          </Card>
        </>
      ) : (
        <Card>
          <div className="text-sm text-gray-600">
            Today&apos;s price:{" "}
            <span className="font-semibold">
              {priceList.find((p) => p.effective_date === today)
                ? formatPeso(
                    priceList.find((p) => p.effective_date === today)!
                      .price_per_kg_centavos,
                  ) + " / kg"
                : "not set yet"}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Only the owner can change prices.
          </p>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-semibold">Price history</h2>
        {priceList.length === 0 ? (
          <EmptyState>No prices yet.</EmptyState>
        ) : (
          <div className="divide-y divide-gray-100">
            {priceList.map((p) => {
              const buyer = buyerList.find(
                (b) => b.effective_date === p.effective_date,
              );
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{formatDate(p.effective_date)}</div>
                    <div className="text-xs text-gray-400">
                      {gradeName(p.grade_id)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">
                      {formatPeso(p.price_per_kg_centavos)}/kg
                    </div>
                    {buyer && (
                      <div className="text-xs text-gray-400">
                        buyer {formatPeso(buyer.price_per_kg_centavos)}/kg
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
