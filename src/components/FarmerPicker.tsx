"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface PickerFarmer {
  id: string;
  name: string;
  barangay: string | null;
}

/** Searchable farmer selector — type to filter instead of scrolling a long list. */
export function FarmerPicker({
  farmers,
  value,
  onChange,
}: {
  farmers: PickerFarmer[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = farmers.find((f) => f.id === value) ?? null;

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return farmers;
    return farmers.filter((f) =>
      `${f.name} ${f.barangay ?? ""}`.toLowerCase().includes(t),
    );
  }, [q, farmers]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQ("");
        }}
        className="field-input flex w-full items-center justify-between text-left"
      >
        <span className={selected ? "" : "text-gray-400"}>
          {selected
            ? `${selected.name}${selected.barangay ? ` — ${selected.barangay}` : ""}`
            : "Select farmer…"}
        </span>
        <span className="ml-2 shrink-0 text-gray-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or barangay…"
              className="field-input w-full"
              type="search"
            />
          </div>
          <div className="max-h-64 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-sm text-gray-400">No farmer found.</div>
            ) : (
              filtered.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    onChange(f.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-gray-50 ${
                    f.id === value ? "bg-brand-50" : ""
                  }`}
                >
                  <span>
                    {f.name}
                    {f.barangay && <span className="text-gray-400"> — {f.barangay}</span>}
                  </span>
                  {f.id === value && <span className="text-brand-600">✓</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
