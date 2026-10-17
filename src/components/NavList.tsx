"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import type { UserRole } from "@/types/db";

const base = [
  { href: "/dashboard", label: "Dashboard", icon: "🏠" },
  { href: "/purchases", label: "Buy copra", icon: "⚖️" },
  { href: "/farmers", label: "Farmers", icon: "👨‍🌾" },
  { href: "/utang", label: "Utang", icon: "📒" },
  { href: "/cash", label: "Cash", icon: "💵" },
  { href: "/stock", label: "Stock", icon: "🏬" },
  { href: "/prices", label: "Prices", icon: "🏷️" },
];
const payables = { href: "/payables", label: "Payables", icon: "💳" };
const ownerExtra = [
  { href: "/sales", label: "Sales", icon: "🚚" },
  { href: "/accounting", label: "Books", icon: "📘" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function linksFor(role: UserRole) {
  return role === "owner"
    ? [
        ...base.slice(0, 4),
        payables, // after Utang (receivables)
        ownerExtra[0], // Sales
        ...base.slice(4),
        ownerExtra[1], // Books
        ownerExtra[2], // Settings
      ]
    : base;
}

export function NavList({
  role,
  onNavigate,
}: {
  role: UserRole;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const links = linksFor(role);

  return (
    <ul className="space-y-1">
      {links.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              className={clsx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-gray-300 hover:bg-white/10 hover:text-white",
              )}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
