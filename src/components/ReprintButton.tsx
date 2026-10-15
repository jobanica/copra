"use client";

import {
  encodeReceipt,
  receiptText,
  type ReceiptData,
} from "@/lib/escpos/receipt";
import {
  isWebBluetoothAvailable,
  printViaBluetooth,
  printViaBrowser,
} from "@/lib/escpos/print";

export function ReprintButton({ receipt }: { receipt: ReceiptData }) {
  async function print() {
    try {
      if (isWebBluetoothAvailable()) {
        await printViaBluetooth(encodeReceipt(receipt));
      } else {
        printViaBrowser(receiptText(receipt));
      }
    } catch {
      printViaBrowser(receiptText(receipt));
    }
  }
  return (
    <button onClick={print} className="btn-primary">
      🖨️ Reprint
    </button>
  );
}
