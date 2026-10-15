"use client";

// Printing to a 58mm Bluetooth thermal printer over Web Bluetooth.
// Supported in Chrome/Edge on Android and desktop. Falls back to the browser
// print dialog (receipt rendered as text) when Web Bluetooth is unavailable.

// Common BLE serial service/characteristic UUIDs used by cheap ESC/POS
// printers. We try the well-known printer service first.
const PRINTER_SERVICES = [
  0x18f0, // common thermal printer service
  "000018f0-0000-1000-8000-00805f9b34fb",
];
const WRITE_CHARACTERISTIC = "00002af1-0000-1000-8000-00805f9b34fb";

export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

type BTDevice = {
  gatt?: {
    connect: () => Promise<{
      getPrimaryService: (s: number | string) => Promise<{
        getCharacteristic: (c: string) => Promise<{
          writeValueWithoutResponse?: (d: BufferSource) => Promise<void>;
          writeValue: (d: BufferSource) => Promise<void>;
        }>;
      }>;
    }>;
    connected: boolean;
    disconnect: () => void;
  };
};

export async function printViaBluetooth(bytes: Uint8Array): Promise<void> {
  if (!isWebBluetoothAvailable()) {
    throw new Error("Web Bluetooth is not available on this device/browser.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bluetooth = (navigator as any).bluetooth;
  const device: BTDevice = await bluetooth.requestDevice({
    filters: [{ services: [PRINTER_SERVICES[0]] }],
    optionalServices: PRINTER_SERVICES,
  });

  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(PRINTER_SERVICES[0]);
  const characteristic = await service.getCharacteristic(WRITE_CHARACTERISTIC);

  // Write in chunks — BLE MTU is small (~180–512 bytes).
  const CHUNK = 180;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.slice(i, i + CHUNK);
    if (characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
  }

  device.gatt?.disconnect();
}

/** Fallback: open a print window with the plain-text receipt. */
export function printViaBrowser(receiptText: string): void {
  const w = window.open("", "_blank", "width=320,height=600");
  if (!w) return;
  w.document.write(
    `<pre style="font-family:'Courier New',monospace;font-size:12px;white-space:pre-wrap;width:58mm">${receiptText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")}</pre>`,
  );
  w.document.close();
  w.focus();
  w.print();
}
