import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, Field, Input, Select } from "@/components/ui";
import { ReportView } from "@/components/ReportView";
import { getReportData, REPORTS, type ReportKey, type ReportParams } from "@/lib/reports";
import { manilaToday } from "@/lib/format";
import type { GlAccount, CashAccount } from "@/types/db";

export const dynamic = "force-dynamic";

const RANGE = new Set<ReportKey>(["income-statement", "ledger", "cash-book", "expenses"]);
const ASOF = new Set<ReportKey>(["balance-sheet", "trial-balance"]);

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isOwner(session.profile)) redirect("/dashboard");

  const { report } = await params;
  const meta = REPORTS.find((r) => r.key === report);
  if (!meta) notFound();
  const key = report as ReportKey;
  const raw = await searchParams;
  const sp = {
    from: typeof raw.from === "string" ? raw.from : undefined,
    to: typeof raw.to === "string" ? raw.to : undefined,
    as_of: typeof raw.as_of === "string" ? raw.as_of : undefined,
    account: typeof raw.account === "string" ? raw.account : undefined,
    year: typeof raw.year === "string" ? raw.year : undefined,
  };

  const today = manilaToday();
  const monthStart = today.slice(0, 8) + "01";
  const defaults: ReportParams = {
    from: sp.from ?? monthStart,
    to: sp.to ?? today,
    as_of: sp.as_of ?? today,
    account: sp.account,
    year: sp.year ?? today.slice(0, 4),
  };

  const supabase = await createClient();

  // Account options for ledger / cash-book.
  let glAccounts: GlAccount[] = [];
  let cashAccounts: CashAccount[] = [];
  if (key === "ledger") {
    const { data } = await supabase.from("gl_accounts").select("*").order("sort_order");
    glAccounts = (data ?? []) as GlAccount[];
  }
  if (key === "cash-book") {
    const { data } = await supabase.from("cash_accounts").select("*").eq("active", true).order("type");
    cashAccounts = (data ?? []) as CashAccount[];
    if (!defaults.account && cashAccounts[0]) defaults.account = cashAccounts[0].id;
  }

  const data = await getReportData(supabase, key, defaults);

  const qs = new URLSearchParams();
  if (RANGE.has(key)) {
    qs.set("from", defaults.from!);
    qs.set("to", defaults.to!);
  }
  if (ASOF.has(key)) qs.set("as_of", defaults.as_of!);
  if (key === "monthly") qs.set("year", defaults.year!);
  if (defaults.account) qs.set("account", defaults.account);
  const exportHref = `/api/export/${key}?${qs.toString()}`;

  return (
    <div className="space-y-4">
      <PageHeader title={meta.title} />

      <Card className="print:hidden">
        <form method="get" className="flex flex-wrap items-end gap-3">
          {RANGE.has(key) && (
            <>
              <Field label="From">
                <Input type="date" name="from" defaultValue={defaults.from} />
              </Field>
              <Field label="To">
                <Input type="date" name="to" defaultValue={defaults.to} />
              </Field>
            </>
          )}
          {ASOF.has(key) && (
            <Field label="As of">
              <Input type="date" name="as_of" defaultValue={defaults.as_of} />
            </Field>
          )}
          {key === "monthly" && (
            <Field label="Year">
              <Input type="number" name="year" defaultValue={defaults.year} className="w-28" />
            </Field>
          )}
          {key === "ledger" && (
            <Field label="Account">
              <Select name="account" defaultValue={defaults.account ?? ""}>
                <option value="">All accounts</option>
                {glAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {key === "cash-book" && (
            <Field label="Account">
              <Select name="account" defaultValue={defaults.account ?? ""}>
                {cashAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <button className="btn-primary">Apply</button>
        </form>
      </Card>

      <ReportView data={data} exportHref={exportHref} />
    </div>
  );
}
