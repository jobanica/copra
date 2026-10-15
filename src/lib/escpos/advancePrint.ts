"use client";

// Shared print logic for cash-advance (utang) receipts, used both when an
// advance is first recorded and when an old receipt is re-opened later.

import { rasterFromDataUrl } from "./raster";
import {
  encodeAdvanceReceipt,
  advanceReceiptText,
  type AdvanceReceiptData,
} from "./advanceReceipt";
import {
  isWebBluetoothAvailable,
  printViaBluetooth,
  printViaBrowser,
} from "./print";

/** Browser-print fallback that embeds the signature image under the ack line. */
function browserPrintWithSignature(d: AdvanceReceiptData, sig: string) {
  const w = window.open("", "_blank", "width=340,height=680");
  if (!w) return;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const txt = esc(
    advanceReceiptText(d).split("Received the above cash advance:")[0] +
      "Received the above cash advance:",
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

/**
 * Print an advance receipt. Uses the Bluetooth thermal printer when available,
 * otherwise opens the browser print dialog. When `sig` is null (e.g. an older
 * advance recorded before signatures), the text-only receipt is printed.
 */
export async function printAdvanceReceipt(
  d: AdvanceReceiptData,
  sig: string | null,
) {
  try {
    if (isWebBluetoothAvailable()) {
      const raster = sig ? await rasterFromDataUrl(sig) : undefined;
      await printViaBluetooth(encodeAdvanceReceipt(d, raster));
    } else if (sig) {
      browserPrintWithSignature(d, sig);
    } else {
      printViaBrowser(advanceReceiptText(d));
    }
  } catch {
    if (sig) browserPrintWithSignature(d, sig);
    else printViaBrowser(advanceReceiptText(d));
  }
}
