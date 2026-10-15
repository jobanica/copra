// Cash advance (utang) acknowledgement receipt for 58mm ESC/POS printers.
import { formatPeso } from "@/lib/money";
import { formatDateTime } from "@/lib/format";

export interface AdvanceReceiptData {
  businessName: string;
  businessAddress?: string;
  footer?: string;
  farmerName: string;
  barangay?: string | null;
  dateISO: string;
  amountCentavos: number;
  previousBalanceCentavos: number;
  newBalanceCentavos: number;
  pending: boolean;
  cashierName?: string | null;
}

const WIDTH = 32;

const ESC = 0x1b;
const GS = 0x1d;
const INIT = [ESC, 0x40];
const ALIGN_LEFT = [ESC, 0x61, 0x00];
const ALIGN_CENTER = [ESC, 0x61, 0x01];
const BOLD_ON = [ESC, 0x45, 0x01];
const BOLD_OFF = [ESC, 0x45, 0x00];
const DOUBLE_ON = [GS, 0x21, 0x11];
const DOUBLE_OFF = [GS, 0x21, 0x00];
const FEED_CUT = [ESC, 0x64, 0x04];

function text(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}
function row(label: string, value: string): string {
  const space = Math.max(1, WIDTH - label.length - value.length);
  if (label.length + value.length >= WIDTH) return `${label}\n${value.padStart(WIDTH)}\n`;
  return `${label}${" ".repeat(space)}${value}\n`;
}
function divider(ch = "-"): string {
  return ch.repeat(WIDTH) + "\n";
}

export function advanceReceiptText(d: AdvanceReceiptData): string {
  let out = "";
  out += `${d.businessName}\n`;
  if (d.businessAddress) out += `${d.businessAddress}\n`;
  out += divider();
  out += "CASH ADVANCE (UTANG)\n";
  out += divider();
  out += row("Date", formatDateTime(d.dateISO));
  out += row("Farmer", d.farmerName);
  if (d.barangay) out += row("Barangay", d.barangay);
  out += divider();
  out += row("Advance amount", formatPeso(d.amountCentavos));
  out += row("Previous utang", formatPeso(d.previousBalanceCentavos));
  out += row("New utang balance", formatPeso(d.newBalanceCentavos));
  if (d.pending) out += "** PENDING OWNER APPROVAL **\n";
  out += divider();
  out += "Received the above cash advance:\n\n\n";
  out += "________________________\n";
  out += `${d.farmerName}\n`;
  if (d.cashierName) {
    out += divider();
    out += row("Released by", d.cashierName);
  }
  if (d.footer) {
    out += divider();
    out += `${d.footer}\n`;
  }
  return out;
}

/** Build the ESC/POS byte stream; `signature` is a GS v 0 raster block. */
export function encodeAdvanceReceipt(
  d: AdvanceReceiptData,
  signature?: Uint8Array,
): Uint8Array {
  const bytes: number[] = [];
  bytes.push(...INIT);

  bytes.push(...ALIGN_CENTER, ...BOLD_ON, ...DOUBLE_ON);
  bytes.push(...text(d.businessName + "\n"));
  bytes.push(...DOUBLE_OFF, ...BOLD_OFF);
  if (d.businessAddress) bytes.push(...text(d.businessAddress + "\n"));

  bytes.push(...text(divider()));
  bytes.push(...BOLD_ON, ...text("CASH ADVANCE (UTANG)\n"), ...BOLD_OFF);

  bytes.push(...ALIGN_LEFT);
  bytes.push(...text(divider()));
  bytes.push(...text(row("Date", formatDateTime(d.dateISO))));
  bytes.push(...text(row("Farmer", d.farmerName)));
  if (d.barangay) bytes.push(...text(row("Barangay", d.barangay)));
  bytes.push(...text(divider()));
  bytes.push(...BOLD_ON, ...text(row("Advance amount", formatPeso(d.amountCentavos))), ...BOLD_OFF);
  bytes.push(...text(row("Previous utang", formatPeso(d.previousBalanceCentavos))));
  bytes.push(...text(row("New utang balance", formatPeso(d.newBalanceCentavos))));
  if (d.pending) {
    bytes.push(...ALIGN_CENTER, ...BOLD_ON, ...text("** PENDING OWNER APPROVAL **\n"), ...BOLD_OFF, ...ALIGN_LEFT);
  }
  bytes.push(...text(divider()));
  bytes.push(...text("Received the above cash advance:\n"));

  if (signature && signature.length > 0) {
    bytes.push(...ALIGN_CENTER, ...Array.from(signature), ...ALIGN_LEFT);
  } else {
    bytes.push(...text("\n\n"));
  }

  bytes.push(...text("________________________\n"));
  bytes.push(...text(d.farmerName + "\n"));
  if (d.cashierName) {
    bytes.push(...text(divider()));
    bytes.push(...text(row("Released by", d.cashierName)));
  }
  if (d.footer) {
    bytes.push(...ALIGN_CENTER, ...text("\n" + d.footer + "\n"));
  }

  bytes.push(...FEED_CUT);
  return new Uint8Array(bytes);
}
