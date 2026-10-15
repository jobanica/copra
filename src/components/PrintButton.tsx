"use client";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button onClick={() => window.print()} className="btn-secondary">
      🖨️ {label}
    </button>
  );
}
