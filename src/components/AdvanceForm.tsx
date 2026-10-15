"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Field, Input, Textarea, FormError } from "@/components/ui";
import { SignaturePad } from "@/components/SignaturePad";
import { formatPeso, pesosToCentavos } from "@/lib/money";
import { rasterFromDataUrl } from "@/lib/escpos/raster";
import {
  encodeAdvanceReceipt,
  advanceReceiptText,
  type AdvanceReceiptData,
} from "@/lib/escpos/advanceReceipt";
import { isWebBluetoothAvailable, printViaBluetooth } from "@/lib/escpos/print";

export interface AdvanceFormProps {
  farmerId: string;
  farmerName: string;
  barangay: string | null;
  balanceCentavos: number;
  business: { name: string; address?: string; footer?: string };
  cashierName: string | null;
}

async function browserPrint(d: AdvanceReceiptData, sig: string) {
  const w = window.open("", "_blank", "width=340,height=680");
  if (!w) return;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const txt = esc(
    advanceReceiptText(d)
      .split("Received the above cash advance:")[0] + "Received the above cash advance:",
  );
  w.document.write(
    `<div style="font-family:'Courier New',monospace;font-size:12px;width:58mm">` +
      `<pre style="white-space:pre-wrap;margin:0">${txt}</pre>` +
      `<img src="${sig}" style="width:90%;display:block;margin:4px auto"/>` +
      `<pre style="white-space:pre-wrap;margin:0">________________________\n${esc(d.farmerName)}</pre>` +
      (d.footer ? `<p style="text-align:center">${esc(d.footer)}</p>` : "") +
      `</div>`,
  );
  w.document.close();
  w.focus();
  w.print();
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
    try {
      if (isWebBluetoothAvailable()) {
        const raster = await rasterFromDataUrl(sig);
        await printViaBluetooth(encodeAdvanceReceipt(d, raster));
      } else {
        await browserPrint(d, sig);
      }
    } catch {
      await browserPrint(d, sig);
    }
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
