import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, StatCard, Field, Input, Select, Badge, EmptyState, LinkButton } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { openDay, recordCount, closeDay, recordEquity } from "./actions";
import { formatPeso } from "@/lib/money";
import { formatDate, manilaToday } from "@/lib/format";
import type {
  CashBalanceRow,
  CashDay,
  CashCount,
  Expense,
  CashAccount,
  GlAccount,
  EquityTransaction,
} from "@/types/db";

export const dynamic = "force-dynamic";

const CASH_ICON: Record<string, string> = {
  cash_on_hand: "💵",
  bank: "🏦",
  gcash: "📱",
};

export default async function CashPage() {
  const session = await getSessionProfile();
  const owner = isOwner(session?.profile);
  const supabase = await createClient();
  const today = manilaToday();

  const [{ data: balances }, { data: day }, { data: cashAccounts }, { data: expenses }] =
    await Promise.all([
      supabase.rpc("cash_balances"),
      supabase.from("cash_days").select("*").eq("business_date", today).maybeSingle(),
      supabase.from("cash_accounts").select("*").eq("active", true).order("type"),
      supabase
        .from("expenses")
        .select("*")
        .order("expense_date", { ascending: false })
        .limit(12),
    ]);

  const balanceRows = (balances ?? []) as CashBalanceRow[];
  const cashDay = day as CashDay | null;
  const cashAccountList = (cashAccounts ?? []) as CashAccount[];
  const expenseRows = (expenses ?? []) as Expense[];

  let expected: number | null = null;
  let lastCount: CashCount | null = null;
  if (cashDay) {
    const [{ data: exp }, { data: count }] = await Promise.all([
      supabase.rpc("cash_day_expected", { p_business_date: today }),
      supabase
        .from("cash_counts")
        .select("*")
        .eq("cash_day_id", cashDay.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    expected = (exp as number | null) ?? null;
    lastCount = count as CashCount | null;
  }

  // Lookups for expense display (owner can read gl accounts; both read cash accounts).
  const { data: glAccounts } = await supabase
    .from("gl_accounts")
    .select("*")
    .order("sort_order");
  const glList = (glAccounts ?? []) as GlAccount[];
  const glName = new Map(glList.map((g) => [g.id, g.name]));
  const cashName = new Map(cashAccountList.map((c) => [c.id, c.name]));
  const expenseAccounts = glList.filter((g) => g.type === "expense");

  let equityRows: EquityTransaction[] = [];
  if (owner) {
    const { data: eq } = await supabase
      .from("equity_transactions")
      .select("*")
      .order("txn_date", { ascending: false })
      .limit(8);
    equityRows = (eq ?? []) as EquityTransaction[];
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cash"
        action={<LinkButton href="/cash/expenses/new">+ Expense</LinkButton>}
      />

      <div className="grid grid-cols-3 gap-3">
        {balanceRows.map((b) => (
          <StatCard
            key={b.cash_account_id}
            label={`${CASH_ICON[b.type] ?? ""} ${b.name}`}
            value={formatPeso(b.balance_centavos)}
          />
        ))}
      </div>

      {/* Cash day cycle */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Cash day · {formatDate(today)}</h2>
          {cashDay && (
            <Badge tone={cashDay.status === "closed" ? "green" : cashDay.status === "counted" ? "amber" : "gray"}>
              {cashDay.status}
            </Badge>
          )}
        </div>

        {!cashDay && (
          <form action={openDay} className="space-y-3">
            <input type="hidden" name="business_date" value={today} />
            <Field label="Opening cash float (₱)">
              <Input type="number" step="0.01" min="0" inputMode="decimal" name="opening_float" defaultValue="0" />
            </Field>
            <button className="btn-primary">Open day</button>
          </form>
        )}

        {cashDay && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-gray-500">Opening float</div>
                <div className="font-semibold">{formatPeso(cashDay.opening_float_centavos)}</div>
              </div>
              <div>
                <div className="text-gray-500">Expected in drawer</div>
                <div className="font-semibold">
                  {expected !== null ? formatPeso(expected) : "—"}
                </div>
              </div>
            </div>

            {lastCount && (
              <div className="rounded-xl bg-gray-50 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Counted</span>
                  <span className="font-semibold">{formatPeso(lastCount.counted_centavos)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Variance</span>
                  <span className={lastCount.variance_centavos === 0 ? "font-semibold text-brand-700" : "font-semibold text-red-600"}>
                    {formatPeso(lastCount.variance_centavos)}
                  </span>
                </div>
              </div>
            )}

            {cashDay.status !== "closed" && (
              <ActionForm action={recordCount} className="space-y-3">
                <input type="hidden" name="business_date" value={today} />
                <Field label="Counted cash in drawer (₱)">
                  <Input type="number" step="0.01" min="0" inputMode="decimal" name="counted" required />
                </Field>
                <SubmitButton variant="secondary">Record count</SubmitButton>
              </ActionForm>
            )}

            {owner && cashDay.status === "counted" && (
              <form action={closeDay}>
                <input type="hidden" name="business_date" value={today} />
                <button className="btn-primary w-full">Approve &amp; close day</button>
              </form>
            )}
          </div>
        )}
      </Card>

      {/* Owner equity */}
      {owner && (
        <Card>
          <h2 className="mb-3 font-semibold">Owner capital / drawings / transfers</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ActionForm action={recordEquity} className="space-y-2">
              <input type="hidden" name="type" value="capital_in" />
              <div className="text-sm font-medium">Capital in</div>
              <Select name="cash_account_id" className="text-sm">
                {cashAccountList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
              <Input type="number" step="0.01" inputMode="decimal" name="amount" placeholder="Amount ₱" />
              <SubmitButton variant="secondary">Add</SubmitButton>
            </ActionForm>

            <ActionForm action={recordEquity} className="space-y-2">
              <input type="hidden" name="type" value="drawing" />
              <div className="text-sm font-medium">Drawing</div>
              <Select name="cash_account_id" className="text-sm">
                {cashAccountList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
              <Input type="number" step="0.01" inputMode="decimal" name="amount" placeholder="Amount ₱" />
              <SubmitButton variant="secondary">Record</SubmitButton>
            </ActionForm>

            <ActionForm action={recordEquity} className="space-y-2">
              <input type="hidden" name="type" value="transfer" />
              <div className="text-sm font-medium">Transfer</div>
              <Select name="from_account_id" className="text-sm">
                {cashAccountList.map((c) => (
                  <option key={c.id} value={c.id}>From: {c.name}</option>
                ))}
              </Select>
              <Select name="to_account_id" className="text-sm">
                {cashAccountList.map((c) => (
                  <option key={c.id} value={c.id}>To: {c.name}</option>
                ))}
              </Select>
              <Input type="number" step="0.01" inputMode="decimal" name="amount" placeholder="Amount ₱" />
              <SubmitButton variant="secondary">Transfer</SubmitButton>
            </ActionForm>
          </div>
          {equityRows.length > 0 && (
            <div className="mt-4 divide-y divide-gray-100 border-t border-gray-100 pt-2">
              {equityRows.map((e) => (
                <div key={e.id} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="capitalize">{e.type.replace("_", " ")} · {formatDate(e.txn_date)}</span>
                  <span className="font-medium">{formatPeso(e.amount_centavos)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Expenses */}
      <Card>
        <h2 className="mb-3 font-semibold">Recent expenses</h2>
        {expenseRows.length === 0 ? (
          <EmptyState>No expenses yet.</EmptyState>
        ) : (
          <div className="divide-y divide-gray-100">
            {expenseRows.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">
                    {glName.get(e.expense_account_id) ?? "Expense"}
                    {e.status === "voided" && (
                      <span className="ml-2">
                        <Badge tone="red">voided</Badge>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">
                    {formatDate(e.expense_date)} · {cashName.get(e.cash_account_id) ?? ""}
                    {e.remarks ? ` · ${e.remarks}` : ""}
                  </div>
                </div>
                <div className={e.status === "voided" ? "text-gray-400 line-through" : "font-medium"}>
                  {formatPeso(e.amount_centavos)}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 text-xs text-gray-400">
          Expense categories: {expenseAccounts.map((a) => a.name).join(", ")}
        </div>
      </Card>
    </div>
  );
}
