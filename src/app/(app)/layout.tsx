import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { AppNav } from "@/components/AppNav";
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

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div>
          <div className="font-bold text-brand-700">CopraBooks</div>
          <div className="text-xs text-gray-500">
            {profile.full_name || email} ·{" "}
            <span className="capitalize">{profile.role}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <OfflineIndicator />
          <SignOutButton />
        </div>
      </header>

      <main className="flex-1 px-4 py-4 pb-24">{children}</main>

      <AppNav role={profile.role} />
    </div>
  );
}
