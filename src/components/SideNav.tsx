"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { UserRole } from "@/types/db";
import { NavList } from "./NavList";

export function SideNav({
  role,
  userLabel,
}: {
  role: UserRole;
  userLabel?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="-ml-1 rounded-lg p-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 lg:hidden print:hidden"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      <div
        onClick={() => setOpen(false)}
        className={clsx(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 lg:hidden print:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden="true"
      />

      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[82%] transform flex-col bg-gray-900 text-white shadow-xl transition-transform duration-200 lg:hidden print:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        role="dialog"
        aria-label="Navigation"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 font-bold">C</span>
            <div>
              <div className="font-bold">CopraBooks</div>
              {userLabel && <div className="text-xs text-gray-400">{userLabel}</div>}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="rounded-lg p-2 text-gray-400 hover:bg-white/10"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          <NavList role={role} onNavigate={() => setOpen(false)} />
        </nav>
      </aside>
    </>
  );
}
