"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, EmptyState, Input, Badge } from "@/components/ui";
import { formatPeso } from "@/lib/money";
import type { FarmerBalanceView } from "@/types/db";

/** Client-side instant search over the loaded farmers (name/barangay/mobile). */
export function FarmersList({ farmers }: { farmers: FarmerBalanceView[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return farmers;
    return farmers.filter((f) => {
      const hay = `${f.name} ${f.barangay ?? ""} ${f.mobile ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [q, farmers]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          🔍
        </span>
        <Input
          type="search"
          inputMode="search"
          placeholder="Search name, barangay or mobile…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
          autoFocus
        />
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-gray-400">
        <span>
          {filtered.length} of {farmers.length} farmer{farmers.length === 1 ? "" : "s"}
        </span>
        {q && (
          <button onClick={() => setQ("")} className="font-medium text-brand-700">
            Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState>No farmers match “{q}”.</EmptyState>
      ) : (
        <Card className="p-0">
          <div className="divide-y divide-gray-100">
            {filtered.map((f) => (
              <Link
                key={f.farmer_id}
                href={`/farmers/${f.farmer_id}`}
                className="flex items-center justify-between px-4 py-3 active:bg-gray-50"
              >
                <div>
                  <div className="font-medium">{f.name}</div>
                  <div className="text-xs text-gray-400">
                    {f.barangay || "—"}
                    {f.mobile ? ` · ${f.mobile}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  {f.balance_centavos > 0 ? (
                    <Badge tone="amber">Utang {formatPeso(f.balance_centavos)}</Badge>
                  ) : (
                    <Badge tone="green">Clear</Badge>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
