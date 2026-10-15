// Weights are kilograms with 2 decimal places.

export function formatKg(kg: number, withUnit = true): string {
  const n = Number(kg).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withUnit ? `${n} kg` : n;
}

export function parseKg(input: string): number {
  const cleaned = input.replace(/[,\s]/g, "").replace(/kg/i, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** net = gross - tare - deduction, clamped at 0, rounded to 2 dp. */
export function netKg(gross: number, tare: number, deduction: number): number {
  return Math.max(0, Math.round((gross - tare - deduction) * 100) / 100);
}

/** Deduction kg from a percentage of (gross - tare). */
export function deductionKgFromPct(
  gross: number,
  tare: number,
  pct: number,
): number {
  return Math.round((gross - tare) * (pct / 100) * 100) / 100;
}

/** gross amount in centavos = round(netKg * pricePerKgCentavos). */
export function grossAmountCentavos(
  net: number,
  pricePerKgCentavos: number,
): number {
  return Math.round(net * pricePerKgCentavos);
}
