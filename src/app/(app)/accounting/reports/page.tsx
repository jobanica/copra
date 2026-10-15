import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { REPORTS } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function ReportsHub() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isOwner(session.profile)) redirect("/dashboard");

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle="Financial reports — view, print (PDF) or export to Excel" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {REPORTS.map((r) => (
          <Link key={r.key} href={`/accounting/reports/${r.key}`}>
            <Card className="flex items-center gap-3 active:bg-gray-50">
              <span className="text-2xl">{r.icon}</span>
              <span className="font-medium">{r.title}</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
