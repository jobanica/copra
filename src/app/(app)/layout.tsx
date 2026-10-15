import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { SideNav } from "@/components/SideNav";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { SignOutButton } from "@/components/SignOutButton";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { profile, email } = session;
  const userLabel = `${profile.full_name || email} · ${profile.role}`;

  return (
    <div className="flex min-h-dvh">
      <DesktopSidebar role={profile.role} userLabel={userLabel} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3 print:hidden">
          <SideNav role={profile.role} userLabel={userLabel} />
          <div className="min-w-0 flex-1 lg:hidden">
            <div className="font-bold text-brand-700">CopraBooks</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <OfflineIndicator />
            <SignOutButton />
          </div>
        </header>

        <main className="flex-1 bg-gray-50 px-4 py-5">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
