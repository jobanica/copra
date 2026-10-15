import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, LinkButton, Badge } from "@/components/ui";
import { closePeriod, reopenPeriod } from "./actions";
import { formatPeso } from "@/lib/money";
import type { AccountBalanceView, TrialBalanceView, AccountingPeriod } from "@/types/db";

export const dynamic = "force-dynamic";

const MONTHS = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default async function AccountingPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isOwner(session.profile)) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: balances }, { data: tb }, { data: periods }] = await Promise.all([
    supabase.from("v_account_balances").select("*").order("sort_order"),
    supabase.from("v_trial_balance").select("*").order("sort_order"),
    supabase.from("accounting_periods").select("*").order("year", { ascending: false }).order("month", { ascending: false }),
  ]);

  const accounts = (balances ?? []) as AccountBalanceView[];
  const trial = (tb ?? []) as TrialBalanceView[];
  const periodRows = (periods ?? []) as AccountingPeriod[];

  const sumBy = (pred: (a: AccountBalanceView) => boolean) =>
    accounts.filter(pred).reduce((s, a) => s + a.balance_centavos, 0);

  const income = sumBy((a) => a.type === "income");
  const expenses = sumBy((a) => a.type === "expense");
  const netIncome = income - expenses;
  const assets = sumBy((a) => a.type === "asset");
  const liabilities = sumBy((a) => a.type === "liability");
  const equityFromAccounts = accounts
    .filter((a) => a.type === "equity")
    .reduce((s, a) => s + (a.normal_balance === "credit" ? a.balance_centavos : -a.balance_centavos), 0);
  const equity = equityFromAccounts + netIncome;

  const tbDebit = trial.reduce((s, t) => s + t.debit_balance_centavos, 0);
  const tbCredit = trial.reduce((s, t) => s + t.credit_balance_centavos, 0);

  const expenseAccounts = accounts.filter((a) => a.type === "expense" && a.balance_centavos !== 0);
  const assetAccounts = accounts.filter((a) => a.type === "asset" && a.balance_centavos !== 0);
  const equityAccounts = accounts.filter((a) => a.type === "equity" && a.balance_centavos !== 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Books"
        subtitle="Double-entry accounting"
        action={<LinkButton href="/accounting/journal">Journal</LinkButton>}
      />

      <div className="grid grid-cols-3 gap-3">
        <LinkButton href="/accounting/reports" variant="primary">Reports</LinkButton>
        <LinkButton href="/accounting/chart" variant="secondary">Chart</LinkButton>
        <LinkButton href="/accounting/manual" variant="secondary">Manual JE</LinkButton>
      </div>

      {/* Income statement */}
      <Card>
        <h2 className="mb-2 font-semibold">Income statement (to date)</h2>
        <div className="flex justify-between py-1 text-sm">
          <span className="text-gray-500">Sales</span>
          <span className="font-medium">{formatPeso(income)}</span>
        </div>
        {expenseAccounts.map((a) => (
          <div key={a.account_id} className="flex justify-between py-1 text-sm">
            <span className="text-gray-500">{a.name}</span>
            <span>-{formatPeso(a.balance_centavos, false)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-gray-100 py-2 text-lg">
          <span className="font-semibold">Net income</span>
          <span className={netIncome >= 0 ? "font-bold text-brand-700" : "font-bold text-red-600"}>
            {formatPeso(netIncome)}
          </span>
        </div>
      </Card>

      {/* Balance sheet */}
      <Card>
        <h2 className="mb-2 font-semibold">Balance sheet</h2>
        <div className="text-xs font-medium uppercase text-gray-400">Assets</div>
        {assetAccounts.map((a) => (
          <div key={a.account_id} className="flex justify-between py-1 text-sm">
            <span className="text-gray-500">{a.name}</span>
            <span>{formatPeso(a.balance_centavos)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-gray-100 py-1 text-sm font-semibold">
          <span>Total assets</span>
          <span>{formatPeso(assets)}</span>
        </div>

        <div className="mt-3 text-xs font-medium uppercase text-gray-400">Liabilities &amp; equity</div>
        {liabilities !== 0 && (
          <div className="flex justify-between py-1 text-sm">
            <span className="text-gray-500">Liabilities</span>
            <span>{formatPeso(liabilities)}</span>
          </div>
        )}
        {equityAccounts.map((a) => (
          <div key={a.account_id} className="flex justify-between py-1 text-sm">
            <span className="text-gray-500">{a.name}</span>
            <span>{a.normal_balance === "credit" ? formatPeso(a.balance_centavos) : `-${formatPeso(a.balance_centavos, false)}`}</span>
          </div>
        ))}
        <div className="flex justify-between py-1 text-sm">
          <span className="text-gray-500">Net income (retained)</span>
          <span>{formatPeso(netIncome)}</span>
        </div>
        <div className="flex justify-between border-t border-gray-100 py-1 text-sm font-semibold">
          <span>Total liabilities &amp; equity</span>
          <span>{formatPeso(liabilities + equity)}</span>
        </div>
        <div className="mt-2 text-xs text-gray-400">
          {assets === liabilities + equity ? "✓ Balanced" : "⚠ Not balanced"}
        </div>
      </Card>

      {/* Trial balance */}
      <Card>
        <h2 className="mb-2 font-semibold">Trial balance</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-400">
              <th className="py-1">Account</th>
              <th className="py-1 text-right">Debit</th>
              <th className="py-1 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {trial.map((t) => (
              <tr key={t.account_id} className="border-b border-gray-50">
                <td className="py-1">{t.code} {t.name}</td>
                <td className="py-1 text-right">{t.debit_balance_centavos ? formatPeso(t.debit_balance_centavos, false) : ""}</td>
                <td className="py-1 text-right">{t.credit_balance_centavos ? formatPeso(t.credit_balance_centavos, false) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="py-2">Total</td>
              <td className="py-2 text-right">{formatPeso(tbDebit, false)}</td>
              <td className="py-2 text-right">{formatPeso(tbCredit, false)}</td>
            </tr>
          </tfoot>
        </table>
        <div className="mt-1 text-xs text-gray-400">
          {tbDebit === tbCredit ? "✓ Debits equal credits" : "⚠ Out of balance"}
        </div>
      </Card>

      {/* Periods */}
      <Card>
        <h2 className="mb-3 font-semibold">Accounting periods</h2>
        {periodRows.length === 0 ? (
          <p className="text-sm text-gray-500">No periods yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {periodRows.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {MONTHS[p.month]} {p.year}{" "}
                  <Badge tone={p.status === "closed" ? "red" : "green"}>{p.status}</Badge>
                </span>
                {p.status === "open" ? (
                  <form action={closePeriod}>
                    <input type="hidden" name="year" value={p.year} />
                    <input type="hidden" name="month" value={p.month} />
                    <button className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium">
                      Close
                    </button>
                  </form>
                ) : (
                  <form action={reopenPeriod}>
                    <input type="hidden" name="year" value={p.year} />
                    <input type="hidden" name="month" value={p.month} />
                    <button className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium">
                      Reopen
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Link href="/accounting/journal" className="btn-secondary w-full">
        View general journal
      </Link>
    </div>
  );
}
