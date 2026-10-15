"use client";

import { useMemo, useState } from "react";
import { Card, Field, Input, Select } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { postSale } from "@/app/(app)/sales/actions";
import { formatPeso } from "@/lib/money";
import { formatKg } from "@/lib/weight";

export interface SaleFormProps {
  buyers: { id: string; name: string }[];
  stockOnHandKg: number;
  avgCostCentavos: number;
  today: string;
  defaultBuyerPricePesos: number;
}

export function SaleForm({
  buyers,
  stockOnHandKg,
  avgCostCentavos,
  today,
  defaultBuyerPricePesos,
}: SaleFormProps) {
  const [loaded, setLoaded] = useState("");
  const [book, setBook] = useState("");
  const [buyerGross, setBuyerGross] = useState("");
  const [buyerDed, setBuyerDed] = useState("");
  const [price, setPrice] = useState(
    defaultBuyerPricePesos ? String(defaultBuyerPricePesos) : "",
  );
  const [amount, setAmount] = useState("");

  const calc = useMemo(() => {
    const l = parseFloat(loaded) || 0;
    const b = parseFloat(book) || l;
    const bg = parseFloat(buyerGross) || 0;
    const bd = parseFloat(buyerDed) || 0;
    const buyerNet = bg > 0 ? Math.round(bg * (1 - bd / 100) * 100) / 100 : 0;
    const suggestedAmount = Math.round(buyerNet * (parseFloat(price) || 0) * 100);
    const cogs = Math.round(l * avgCostCentavos);
    const shrinkKg = Math.max(0, Math.round((b - l) * 100) / 100);
    const amountC =
      amount.trim() !== ""
        ? Math.round((parseFloat(amount) || 0) * 100)
        : suggestedAmount;
    const grossProfit = amountC - cogs;
    return { l, b, buyerNet, suggestedAmount, cogs, shrinkKg, amountC, grossProfit };
  }, [loaded, book, buyerGross, buyerDed, price, amount, avgCostCentavos]);

  const overStock = calc.b > stockOnHandKg;

  return (
    <ActionForm action={postSale} className="space-y-4">
      <Card className="space-y-3">
        <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
          Stock on hand: <strong>{formatKg(stockOnHandKg)}</strong> · avg cost{" "}
          <strong>{formatPeso(avgCostCentavos)}/kg</strong>
        </div>
        <Field label="Buyer / trader">
          <Select name="buyer_id" defaultValue="">
            <option value="">— select —</option>
            {buyers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" name="sale_date" defaultValue={today} />
          </Field>
          <Field label="Payment">
            <Select name="payment_method" defaultValue="bank">
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="gcash">GCash</option>
            </Select>
          </Field>
          <Field label="Plate no.">
            <Input name="plate_no" />
          </Field>
          <Field label="Driver">
            <Input name="driver" />
          </Field>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Our side</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Loaded kg (actual)">
            <Input
              type="number"
              step="0.01"
              inputMode="decimal"
              name="our_loaded_kg"
              value={loaded}
              onChange={(e) => setLoaded(e.target.value)}
              required
            />
          </Field>
          <Field label="Book kg" hint="Blank = same as loaded">
            <Input
              type="number"
              step="0.01"
              inputMode="decimal"
              name="book_kg"
              value={book}
              onChange={(e) => setBook(e.target.value)}
            />
          </Field>
          <Field label="Our avg deduction %">
            <Input type="number" step="0.01" inputMode="decimal" name="our_avg_deduction_pct" />
          </Field>
        </div>
        {calc.shrinkKg > 0 && (
          <div className="text-sm text-amber-700">
            Shrinkage write-off: <strong>{formatKg(calc.shrinkKg)}</strong>
          </div>
        )}
        {overStock && (
          <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">
            Drawing {formatKg(calc.b)} exceeds stock on hand ({formatKg(stockOnHandKg)}).
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Buyer&apos;s side</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Buyer gross kg">
            <Input
              type="number"
              step="0.01"
              inputMode="decimal"
              name="buyer_gross_kg"
              value={buyerGross}
              onChange={(e) => setBuyerGross(e.target.value)}
            />
          </Field>
          <Field label="Buyer deduction %">
            <Input
              type="number"
              step="0.01"
              inputMode="decimal"
              name="buyer_deduction_pct"
              value={buyerDed}
              onChange={(e) => setBuyerDed(e.target.value)}
            />
          </Field>
        </div>
        <input type="hidden" name="buyer_net_kg" value={calc.buyerNet || ""} />
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Buyer net kg</span>
          <span className="font-semibold">{formatKg(calc.buyerNet)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Buyer price / kg (₱)">
            <Input
              type="number"
              step="0.01"
              inputMode="decimal"
              name="price_per_kg"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field label="Amount received (₱)" hint={`Suggested ${formatPeso(calc.suggestedAmount)}`}>
            <Input
              type="number"
              step="0.01"
              inputMode="decimal"
              name="amount_received"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={(calc.suggestedAmount / 100).toFixed(2)}
            />
          </Field>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Truckload expenses (₱)</h2>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Trucking">
            <Input type="number" step="0.01" inputMode="decimal" name="trucking" />
          </Field>
          <Field label="Labor">
            <Input type="number" step="0.01" inputMode="decimal" name="labor" />
          </Field>
          <Field label="Other">
            <Input type="number" step="0.01" inputMode="decimal" name="other" />
          </Field>
        </div>
        <Field label="Remarks">
          <Input name="remarks" />
        </Field>
      </Card>

      <Card className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Est. cost of sales</span>
          <span>{formatPeso(calc.cogs)}</span>
        </div>
        <div className="flex justify-between border-t border-gray-100 pt-1 text-lg">
          <span className="font-semibold">Est. gross profit</span>
          <span
            className={
              calc.grossProfit >= 0 ? "font-bold text-brand-700" : "font-bold text-red-600"
            }
          >
            {formatPeso(calc.grossProfit)}
          </span>
        </div>
        <p className="text-xs text-gray-400">
          Final figures are computed on the server at weighted-average cost.
        </p>
      </Card>

      <SubmitButton className="w-full py-4 text-lg">Record sale</SubmitButton>
    </ActionForm>
  );
}
