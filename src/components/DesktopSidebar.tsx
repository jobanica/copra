import { NavList } from "./NavList";
import type { UserRole } from "@/types/db";

export function DesktopSidebar({
  role,
  userLabel,
}: {
  role: UserRole;
  userLabel?: string;
}) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-gray-900 text-white lg:flex print:hidden">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-lg font-bold">
          C
        </span>
        <span className="text-lg font-bold">CopraBooks</span>
      </div>
      <div className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        Menu
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        <NavList role={role} />
      </nav>
      {userLabel && (
        <div className="border-t border-white/10 px-5 py-3 text-xs text-gray-400">
          {userLabel}
        </div>
      )}
    </aside>
  );
}
