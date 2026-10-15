// ESC/POS encoder for 58mm Bluetooth thermal printers (32 chars/line, Font A).
import { formatPeso } from "@/lib/money";
import { formatKg } from "@/lib/weight";
import { formatDateTime } from "@/lib/format";

export interface ReceiptData {
  businessName: string;
  businessAddress?: string;
  footer?: string;
  receiptNo: number;
  purchasedAt: string;
  farmerName: string;
  barangay?: string | null;
  grossKg: number;
  tareKg: number;
  deductionKg: number;
  deductionPct: number;
  netKg: number;
  pricePerKgCentavos: number;
  grossAmountCentavos: number;
  utangDeductedCentavos: number;
  previousUtangCentavos: number;
  remainingUtangCentavos: number;
  cashPaidCentavos: number;
  cashierName?: string | null;
}

const WIDTH = 32;

// ---- ESC/POS control codes -------------------------------------------------
const ESC = 0x1b;
const GS = 0x1d;
const INIT = [ESC, 0x40];
const ALIGN_LEFT = [ESC, 0x61, 0x00];
const ALIGN_CENTER = [ESC, 0x61, 0x01];
const BOLD_ON = [ESC, 0x45, 0x01];
const BOLD_OFF = [ESC, 0x45, 0x00];
const DOUBLE_ON = [GS, 0x21, 0x11]; // double width + height
const DOUBLE_OFF = [GS, 0x21, 0x00];
const FEED_CUT = [ESC, 0x64, 0x04]; // feed 4 lines (no auto-cutter on most 58mm)

function text(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

/** Left label + right value padded to WIDTH. */
function row(label: string, value: string): string {
  const space = Math.max(1, WIDTH - label.length - value.length);
  if (label.length + value.length >= WIDTH) {
    return `${label}\n${value.padStart(WIDTH)}\n`;
  }
  return `${label}${" ".repeat(space)}${value}\n`;
}

function divider(ch = "-"): string {
  return ch.repeat(WIDTH) + "\n";
}

/** Build the full receipt as human-readable text (used for preview + fallback). */
export function receiptText(d: ReceiptData): string {
  let out = "";
  out += `${d.businessName}\n`;
  if (d.businessAddress) out += `${d.businessAddress}\n`;
  out += divider();
  out += row("Receipt #", String(d.receiptNo));
  out += row("Date", formatDateTime(d.purchasedAt));
  out += row("Farmer", d.farmerName);
  if (d.barangay) out += row("Barangay", d.barangay);
  out += divider();
  out += row("Gross", formatKg(d.grossKg));
  out += row("Tare (sacks)", `-${formatKg(d.tareKg, false)}`);
  out += row(
    `Deduction ${d.deductionPct}%`,
    `-${formatKg(d.deductionKg, false)}`,
  );
  out += row("Net weight", formatKg(d.netKg));
  out += divider();
  out += row("Price/kg", formatPeso(d.pricePerKgCentavos));
  out += row("Gross amount", formatPeso(d.grossAmountCentavos));
  if (d.utangDeductedCentavos > 0) {
    out += row("Utang deducted", `-${formatPeso(d.utangDeductedCentavos, false)}`);
  }
  out += row("CASH PAID", formatPeso(d.cashPaidCentavos));
  out += divider();
  out += row("Previous utang", formatPeso(d.previousUtangCentavos));
  out += row("Remaining utang", formatPeso(d.remainingUtangCentavos));
  if (d.cashierName) {
    out += divider();
    out += row("Cashier", d.cashierName);
  }
  if (d.footer) {
    out += divider();
    out += `${d.footer}\n`;
  }
  return out;
}

/** Build ESC/POS bytes for the receipt. */
export function encodeReceipt(d: ReceiptData): Uint8Array {
  const bytes: number[] = [];
  bytes.push(...INIT);

  // Header — centered, bold, double size business name.
  bytes.push(...ALIGN_CENTER, ...BOLD_ON, ...DOUBLE_ON);
  bytes.push(...text(d.businessName + "\n"));
  bytes.push(...DOUBLE_OFF, ...BOLD_OFF);
  if (d.businessAddress) bytes.push(...text(d.businessAddress + "\n"));

  // Body — left aligned.
  bytes.push(...ALIGN_LEFT);
  bytes.push(...text(divider()));
  bytes.push(...text(row("Receipt #", String(d.receiptNo))));
  bytes.push(...text(row("Date", formatDateTime(d.purchasedAt))));
  bytes.push(...text(row("Farmer", d.farmerName)));
  if (d.barangay) bytes.push(...text(row("Barangay", d.barangay)));
  bytes.push(...text(divider()));
  bytes.push(...text(row("Gross", formatKg(d.grossKg))));
  bytes.push(...text(row("Tare (sacks)", `-${formatKg(d.tareKg, false)}`)));
  bytes.push(
    ...text(row(`Deduction ${d.deductionPct}%`, `-${formatKg(d.deductionKg, false)}`)),
  );
  bytes.push(...BOLD_ON, ...text(row("Net weight", formatKg(d.netKg))), ...BOLD_OFF);
  bytes.push(...text(divider()));
  bytes.push(...text(row("Price/kg", formatPeso(d.pricePerKgCentavos))));
  bytes.push(...text(row("Gross amount", formatPeso(d.grossAmountCentavos))));
  if (d.utangDeductedCentavos > 0) {
    bytes.push(
      ...text(row("Utang deducted", `-${formatPeso(d.utangDeductedCentavos, false)}`)),
    );
  }
  bytes.push(...BOLD_ON, ...text(row("CASH PAID", formatPeso(d.cashPaidCentavos))), ...BOLD_OFF);
  bytes.push(...text(divider()));
  bytes.push(...text(row("Previous utang", formatPeso(d.previousUtangCentavos))));
  bytes.push(...text(row("Remaining utang", formatPeso(d.remainingUtangCentavos))));
  if (d.cashierName) {
    bytes.push(...text(divider()));
    bytes.push(...text(row("Cashier", d.cashierName)));
  }
  if (d.footer) {
    bytes.push(...ALIGN_CENTER, ...text("\n" + d.footer + "\n"));
  }

  bytes.push(...FEED_CUT);
  return new Uint8Array(bytes);
}
