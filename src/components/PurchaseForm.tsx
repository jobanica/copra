"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Field, Input, Select, Textarea, FormError } from "@/components/ui";
import { formatPeso, formatPeso as peso } from "@/lib/money";
import { formatKg } from "@/lib/weight";
import { netKg, deductionKgFromPct, grossAmountCentavos } from "@/lib/weight";
import { enqueuePurchase, type PurchasePayload } from "@/lib/offline/db";
import { encodeReceipt, receiptText, type ReceiptData } from "@/lib/escpos/receipt";
import {
  isWebBluetoothAvailable,
  printViaBluetooth,
  printViaBrowser,
} from "@/lib/escpos/print";

export interface FarmerOption {
  id: string;
  name: string;
  barangay: string | null;
  balance_centavos: number;
}
export interface GradeOption {
  id: string;
  name: string;
}
export interface PurchaseFormProps {
  farmers: FarmerOption[];
  grades: GradeOption[];
  priceByGrade: Record<string, number>; // key: grade_id or "null"
  today: string;
  business: { name: string; address?: string; footer?: string };
  cashierName: string | null;
}

export function PurchaseForm({
  farmers,
  grades,
  priceByGrade,
  business,
  cashierName,
}: PurchaseFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const [farmerId, setFarmerId] = useState(farmers[0]?.id ?? "");
  const [gradeId, setGradeId] = useState(grades[0]?.id ?? "");
  const [sackCount, setSackCount] = useState("");
  const [gross, setGross] = useState("");
  const [tare, setTare] = useState("");
  const [dedMode, setDedMode] = useState<"pct" | "kg">("pct");
  const [dedValue, setDedValue] = useState("");
  const [utang, setUtang] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);

  const priceKey = grades.length > 0 ? gradeId : "null";
  const price = priceByGrade[priceKey] ?? priceByGrade["null"] ?? null;

  const farmer = farmers.find((f) => f.id === farmerId) ?? null;
  const balance = farmer?.balance_centavos ?? 0;

  const calc = useMemo(() => {
    const g = parseFloat(gross) || 0;
    const t = parseFloat(tare) || 0;
    const dv = parseFloat(dedValue) || 0;
    const dedKg = dedMode === "pct" ? deductionKgFromPct(g, t, dv) : dv;
    const dedPct =
      dedMode === "pct"
        ? dv
        : g - t > 0
          ? Math.round((dedKg / (g - t)) * 10000) / 100
          : 0;
    const net = netKg(g, t, dedKg);
    const grossAmt = price !== null ? grossAmountCentavos(net, price) : 0;
    const utangCentavos = Math.min(
      Math.round((parseFloat(utang) || 0) * 100),
      Math.min(grossAmt, balance),
    );
    const cashPaid = grossAmt - utangCentavos;
    return { dedKg, dedPct, net, grossAmt, utangCentavos, cashPaid };
  }, [gross, tare, dedValue, dedMode, utang, price, balance]);

  const canSubmit =
    price !== null && farmerId !== "" && (parseFloat(gross) || 0) > 0 && !busy;

  async function submit() {
    if (!farmer || price === null) return;
    setError(null);
    setBusy(true);

    const clientUuid = crypto.randomUUID();
    const purchasedAt = new Date().toISOString();
    const payload: PurchasePayload = {
      p_farmer_id: farmerId,
      p_grade_id: grades.length > 0 ? gradeId : null,
      p_purchased_at: purchasedAt,
      p_sack_count: parseInt(sackCount) || 0,
      p_gross_kg: parseFloat(gross) || 0,
      p_tare_kg: parseFloat(tare) || 0,
      p_deduction_kg: calc.dedKg,
      p_deduction_pct: calc.dedPct,
      p_price_per_kg_centavos: price,
      p_utang_deducted_centavos: calc.utangCentavos,
      p_remarks: remarks || null,
      p_scale_photo_url: null,
      p_client_uuid: clientUuid,
    };

    const baseReceipt: Omit<ReceiptData, "receiptNo"> = {
      businessName: business.name,
      businessAddress: business.address,
      footer: business.footer,
      purchasedAt,
      farmerName: farmer.name,
      barangay: farmer.barangay,
      grossKg: payload.p_gross_kg,
      tareKg: payload.p_tare_kg,
      deductionKg: calc.dedKg,
      deductionPct: calc.dedPct,
      netKg: calc.net,
      pricePerKgCentavos: price,
      grossAmountCentavos: calc.grossAmt,
      utangDeductedCentavos: calc.utangCentavos,
      previousUtangCentavos: balance,
      remainingUtangCentavos: balance - calc.utangCentavos,
      cashPaidCentavos: calc.cashPaid,
      cashierName,
    };

    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("offline");
      }
      const { data, error } = await supabase.rpc("post_purchase", payload);
      if (error) {
        // Network error -> queue; business error -> surface.
        const msg = error.message?.toLowerCase() ?? "";
        if (msg.includes("fetch") || msg.includes("network")) {
          throw new Error("offline");
        }
        setError(error.message);
        setBusy(false);
        return;
      }
      const row = data as { receipt_no: number };
      setReceipt({ ...baseReceipt, receiptNo: row.receipt_no });
      setSavedOffline(false);
      router.refresh();
    } catch {
      // Offline (or network) — queue locally.
      await enqueuePurchase({
        client_uuid: clientUuid,
        farmer_name: farmer.name,
        payload,
        created_at: purchasedAt,
      });
      window.dispatchEvent(new Event("copra:queued"));
      setReceipt({ ...baseReceipt, receiptNo: 0 });
      setSavedOffline(true);
    } finally {
      setBusy(false);
    }
  }

  function resetForm() {
    setReceipt(null);
    setSavedOffline(false);
    setSackCount("");
    setGross("");
    setTare("");
    setDedValue("");
    setUtang("");
    setRemarks("");
  }

  async function print() {
    if (!receipt) return;
    try {
      if (isWebBluetoothAvailable()) {
        await printViaBluetooth(encodeReceipt(receipt));
      } else {
        printViaBrowser(receiptText(receipt));
      }
    } catch (e) {
      // Fall back to the browser print dialog.
      printViaBrowser(receiptText(receipt));
      void e;
    }
  }

  if (receipt) {
    return (
      <div className="space-y-4">
        {savedOffline && (
          <div className="rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-800">
            Saved offline — it will sync and get a receipt number when you&apos;re
            back online.
          </div>
        )}
        <Card>
          <pre className="whitespace-pre-wrap font-mono text-xs leading-5">
            {receiptText(receipt)}
          </pre>
        </Card>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={print} className="btn-primary">
            🖨️ Print receipt
          </button>
          <button onClick={resetForm} className="btn-secondary">
            New purchase
          </button>
        </div>
      </div>
    );
  }

  if (price === null) {
    return (
      <Card className="border-amber-300 bg-amber-50">
        <div className="font-semibold text-amber-800">
          Today&apos;s buying price is not set.
        </div>
        <p className="mt-1 text-sm text-amber-700">
          Purchases cannot be recorded until the owner sets today&apos;s price.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <Field label="Farmer">
          <Select value={farmerId} onChange={(e) => setFarmerId(e.target.value)}>
            {farmers.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.barangay ? ` — ${f.barangay}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        {balance > 0 && (
          <div className="text-sm text-amber-700">
            Current utang: <strong>{formatPeso(balance)}</strong>
          </div>
        )}

        {grades.length > 0 && (
          <Field label="Grade">
            <Select value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
          Price today: <strong>{formatPeso(price)}/kg</strong>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Sacks">
            <Input
              type="number"
              inputMode="numeric"
              value={sackCount}
              onChange={(e) => setSackCount(e.target.value)}
            />
          </Field>
          <Field label="Gross kg">
            <Input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={gross}
              onChange={(e) => setGross(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Tare kg (sacks)">
            <Input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={tare}
              onChange={(e) => setTare(e.target.value)}
            />
          </Field>
          <Field label={`Deduction (${dedMode})`}>
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={dedValue}
                onChange={(e) => setDedValue(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setDedMode(dedMode === "pct" ? "kg" : "pct")}
                className="btn-secondary px-3 py-2 text-sm"
              >
                {dedMode === "pct" ? "%" : "kg"}
              </button>
            </div>
          </Field>
        </div>
      </Card>

      <Card className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Deduction</span>
          <span>
            {formatKg(calc.dedKg, false)} kg ({calc.dedPct}%)
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Net weight</span>
          <span className="font-semibold">{formatKg(calc.net)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Gross amount</span>
          <span className="font-semibold">{peso(calc.grossAmt)}</span>
        </div>

        <Field label="Utang deducted (₱)" hint={`Max ${formatPeso(Math.min(calc.grossAmt, balance))}`}>
          <Input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={utang}
            onChange={(e) => setUtang(e.target.value)}
            disabled={balance === 0}
          />
        </Field>

        <div className="flex justify-between border-t border-gray-100 pt-2 text-lg">
          <span className="font-semibold">CASH TO PAY</span>
          <span className="font-bold text-brand-700">{peso(calc.cashPaid)}</span>
        </div>
      </Card>

      <Card>
        <Field label="Remarks">
          <Textarea
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </Field>
      </Card>

      <FormError message={error} />

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="btn-primary w-full py-5 text-lg"
      >
        {busy ? "Saving…" : `Record purchase · ${peso(calc.cashPaid)}`}
      </button>
    </div>
  );
}
