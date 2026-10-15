"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Field, Input, FormError } from "@/components/ui";
import { SignaturePad } from "@/components/SignaturePad";
import { formatPeso, pesosToCentavos } from "@/lib/money";
import { type AdvanceReceiptData } from "@/lib/escpos/advanceReceipt";
import { printAdvanceReceipt } from "@/lib/escpos/advancePrint";

export interface AdvanceFormProps {
  farmerId: string;
  farmerName: string;
  barangay: string | null;
  balanceCentavos: number;
  business: { name: string; address?: string; footer?: string };
  cashierName: string | null;
}

export function AdvanceForm({
  farmerId,
  farmerName,
  barangay,
  balanceCentavos,
  business,
  cashierName,
}: AdvanceFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ receipt: AdvanceReceiptData; sig: string } | null>(null);

  const amt = parseFloat(amount) || 0;
  const canSubmit = amt > 0 && !!signature && !busy;

  async function printReceipt(d: AdvanceReceiptData, sig: string) {
    await printAdvanceReceipt(d, sig);
  }

  async function submit() {
    if (!signature) {
      setError("A signature is required for a cash advance.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const centavos = pesosToCentavos(amt);
      const { data, error } = await supabase.rpc("create_advance", {
        p_farmer_id: farmerId,
        p_amount_centavos: centavos,
        p_remarks: remarks || null,
        p_signature: signature,
      });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      const pending = (data as { status?: string } | null)?.status === "pending";
      const receipt: AdvanceReceiptData = {
        businessName: business.name,
        businessAddress: business.address,
        footer: business.footer,
        farmerName,
        barangay,
        dateISO: new Date().toISOString(),
        amountCentavos: centavos,
        previousBalanceCentavos: balanceCentavos,
        newBalanceCentavos: balanceCentavos + centavos,
        pending,
        cashierName,
      };
      setDone({ receipt, sig: signature });
      await printReceipt(receipt, signature);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
          Advance of {formatPeso(done.receipt.amountCentavos)} recorded
          {done.receipt.pending ? " — pending owner approval." : "."}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => printReceipt(done.receipt, done.sig)} className="btn-primary">
            🖨️ Print again
          </button>
          <button
            onClick={() => {
              setDone(null);
              setAmount("");
              setRemarks("");
              setSignature(null);
            }}
            className="btn-secondary"
          >
            New advance
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Field label="Amount (₱)">
        <Input
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label="Remarks">
        <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
      <Field label="Farmer's signature">
        <SignaturePad onChange={setSignature} />
      </Field>
      <FormError message={error} />
      <button onClick={submit} disabled={!canSubmit} className="btn-primary w-full">
        {busy ? "Saving…" : `Record advance & print${amt > 0 ? ` · ${formatPeso(pesosToCentavos(amt))}` : ""}`}
      </button>
      {!signature && (
        <p className="text-center text-xs text-gray-400">
          The farmer must sign before the advance can be recorded.
        </p>
      )}
    </div>
  );
}
