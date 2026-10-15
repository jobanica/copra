"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import type { UserRole } from "@/types/db";

const base = [
  { href: "/dashboard", label: "Home", icon: "🏠" },
  { href: "/purchases", label: "Buy", icon: "⚖️" },
  { href: "/farmers", label: "Farmers", icon: "👨‍🌾" },
  { href: "/utang", label: "Utang", icon: "📒" },
  { href: "/cash", label: "Cash", icon: "💵" },
  { href: "/stock", label: "Stock", icon: "🏬" },
  { href: "/prices", label: "Prices", icon: "🏷️" },
];
const ownerExtra = [
  { href: "/sales", label: "Sales", icon: "🚚" },
  { href: "/accounting", label: "Books", icon: "📘" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function AppNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const links =
    role === "owner"
      ? [
          ...base.slice(0, 4),
          ownerExtra[0], // Sales after Utang
          ...base.slice(4),
          ownerExtra[1], // Books
          ownerExtra[2], // Settings last
        ]
      : base;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-2xl border-t border-gray-200 bg-white">
      <ul className="flex overflow-x-auto">
        {links.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <li key={item.href} className="shrink-0 basis-[4.25rem] grow">
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
