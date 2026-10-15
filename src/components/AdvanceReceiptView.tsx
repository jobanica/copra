"use client";

import { formatPeso } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { printAdvanceReceipt } from "@/lib/escpos/advancePrint";
import type { AdvanceReceiptData } from "@/lib/escpos/advanceReceipt";

/** On-screen reproduction of a cash-advance receipt, with a re-print button. */
export function AdvanceReceiptView({
  data,
  signature,
  rejected,
}: {
  data: AdvanceReceiptData;
  signature: string | null;
  rejected?: boolean;
}) {
  const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className={bold ? "font-semibold text-gray-900" : "text-gray-800"}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="mx-auto w-full max-w-xs rounded-2xl border border-gray-200 bg-white p-5 font-mono text-xs leading-relaxed shadow-sm">
        <div className="text-center">
          <div className="text-sm font-bold tracking-tight">{data.businessName}</div>
          {data.businessAddress && (
            <div className="text-[11px] text-gray-500">{data.businessAddress}</div>
          )}
        </div>

        <div className="my-2 border-t border-dashed border-gray-300" />
        <div className="text-center font-semibold tracking-wide">CASH ADVANCE (UTANG)</div>
        <div className="my-2 border-t border-dashed border-gray-300" />

        <div className="space-y-1">
          <Row label="Date" value={formatDateTime(data.dateISO)} />
          <Row label="Farmer" value={data.farmerName} />
          {data.barangay && <Row label="Barangay" value={data.barangay} />}
        </div>

        <div className="my-2 border-t border-dashed border-gray-300" />
        <div className="space-y-1">
          <Row label="Advance amount" value={formatPeso(data.amountCentavos)} bold />
          <Row label="Previous utang" value={formatPeso(data.previousBalanceCentavos)} />
          <Row label="New utang balance" value={formatPeso(data.newBalanceCentavos)} />
        </div>

        {data.pending && (
          <div className="mt-2 text-center font-semibold text-amber-600">
            ** PENDING OWNER APPROVAL **
          </div>
        )}
        {rejected && (
          <div className="mt-2 text-center font-semibold text-rose-600">
            ** ADVANCE REJECTED **
          </div>
        )}

        <div className="my-2 border-t border-dashed border-gray-300" />
        <div className="text-gray-600">Received the above cash advance:</div>

        <div className="mt-2 flex min-h-[70px] items-end justify-center">
          {signature ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={signature} alt="Farmer's signature" className="max-h-24 w-auto" />
          ) : (
            <span className="text-[11px] italic text-gray-400">No signature on file</span>
          )}
        </div>
        <div className="border-t border-gray-400 pt-1 text-center">{data.farmerName}</div>

        {data.cashierName && (
          <>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <Row label="Released by" value={data.cashierName} />
          </>
        )}
        {data.footer && (
          <div className="mt-2 text-center text-[11px] text-gray-500">{data.footer}</div>
        )}
      </div>

      <button
        onClick={() => printAdvanceReceipt(data, signature)}
        className="btn-primary w-full"
      >
        🖨️ Print receipt
      </button>
    </div>
  );
}
