// Money is always integer centavos. Never use floats for money math.

/** Format centavos as a peso string, e.g. 123456 -> "₱1,234.56". */
export function formatPeso(centavos: number, withSymbol = true): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(Math.round(centavos));
  const pesos = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = pesos.toLocaleString("en-PH");
  return `${sign}${withSymbol ? "₱" : ""}${grouped}.${cents.toString().padStart(2, "0")}`;
}

/** Parse a peso input ("1,234.56" or "1234.5") into integer centavos. */
export function parsePesoToCentavos(input: string): number {
  const cleaned = input.replace(/[₱,\s]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Pesos (as a number) to centavos. */
export function pesosToCentavos(pesos: number): number {
  return Math.round(pesos * 100);
}
