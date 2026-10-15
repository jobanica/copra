"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface DashboardFilterProps {
  from: string;
  to: string;
  today: string;
}

/** Subtract `days` from a YYYY-MM-DD string (UTC math, calendar-safe). */
function minusDays(ymd: string, days: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function DashboardFilter({ from, to, today }: DashboardFilterProps) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  function go(nf: string, nt: string) {
    setF(nf);
    setT(nt);
    const q = new URLSearchParams({ from: nf, to: nt });
    router.push(`/dashboard?${q.toString()}`);
  }

  const presets: { label: string; from: string; to: string }[] = [
    { label: "Today", from: today, to: today },
    { label: "7D", from: minusDays(today, 6), to: today },
    { label: "14D", from: minusDays(today, 13), to: today },
    { label: "30D", from: minusDays(today, 29), to: today },
    { label: "Month", from: today.slice(0, 7) + "-01", to: today },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const active = f === p.from && t === p.to;
          return (
            <button
              key={p.label}
              onClick={() => go(p.from, p.to)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "bg-brand-600 text-white"
                  : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={f}
          max={t}
          onChange={(e) => go(e.target.value, t)}
          className="rounded-lg border border-gray-200 px-2 py-1 text-xs"
        />
        <span className="text-xs text-gray-400">→</span>
        <input
          type="date"
          value={t}
          min={f}
          max={today}
          onChange={(e) => go(f, e.target.value)}
          className="rounded-lg border border-gray-200 px-2 py-1 text-xs"
        />
      </div>
    </div>
  );
}
