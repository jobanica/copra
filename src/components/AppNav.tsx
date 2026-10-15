"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import type { UserRole } from "@/types/db";

const items = [
  { href: "/dashboard", label: "Home", icon: "🏠" },
  { href: "/purchases", label: "Buy", icon: "⚖️" },
  { href: "/farmers", label: "Farmers", icon: "👨‍🌾" },
  { href: "/utang", label: "Utang", icon: "📒" },
  { href: "/prices", label: "Prices", icon: "🏷️" },
];

export function AppNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const links =
    role === "owner"
      ? [...items, { href: "/settings", label: "Settings", icon: "⚙️" }]
      : items;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-2xl border-t border-gray-200 bg-white">
      <ul className="flex">
        {links.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={clsx(
                  "flex flex-col items-center gap-0.5 py-2 text-xs font-medium",
                  active ? "text-brand-700" : "text-gray-500",
                )}
              >
                <span className="text-xl leading-none">{item.icon}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
