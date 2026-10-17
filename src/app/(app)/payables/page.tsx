import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import {
  PageHeader,
  Card,
  Field,
  Input,
  Select,
  Badge,
  EmptyState,
  StatCard,
} from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { createPayable, payPayable, voidPayable } from "./actions";
import { formatPeso } from "@/lib/money";
import { formatDate, manilaToday } from "@/lib/format";
import type { PayableBalanceView, GlAccount, CashAccount } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function PayablesPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isOwner(session.profile)) redirect("/dashboard");

  const supabase = await createClient();
  const today = manilaToday();
  const [{ data: payables }, { data: gl }, { data: cash }] = await Promise.all([
    supabase
      .from("v_payable_balances")
      .select("*")
      .order("status")
      .order("incurred_date", { ascending: false }),
    supabase.from("gl_accounts").select("*").eq("type", "expense").order("sort_order"),
    supabase.from("cash_accounts").select("*").eq("active", true).order("type"),
  ]);

  const rows = (payables ?? []) as PayableBalanceView[];
  const expenseAccounts = (gl ?? []) as GlAccount[];
  const cashAccounts = (cash ?? []) as CashAccount[];

  const open = rows.filter((r) => r.status === "open");
  const totalOutstanding = open.reduce((s, r) => s + Number(r.balance_centavos), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Payables" subtitle="Money the station owes" />

      <StatCard label="Total payable (outstanding)" value={formatPeso(totalOutstanding)} />

      <Card>
        <h2 className="mb-3 font-semibold">New payable</h2>
        <ActionForm action={createPayable} className="space-y-3">
          <Field label="Payable to (payee)">
            <Input name="payee" placeholder="e.g. Dealer, supplier, lender" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₱)">
              <Input type="number" step="0.01" min="0" inputMode="decimal" name="amount" required />
            </Field>
            <Field label="Category">
              <Input name="category" placeholder="Loan, Rent, Supplies…" />
            </Field>
            <Field label="Date incurred">
              <Input type="date" name="incurred_date" defaultValue={today} />
            </Field>
            <Field label="Due date">
              <Input type="date" name="due_date" />
            </Field>
          </div>
          <Field label="Booked against" hint="Which expense it is for (default: Other Expenses).">
            <Select name="offset_account_id" defaultValue="">
              <option value="">Other Expenses</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Remarks">
            <Input name="remarks" />
          </Field>
          <SubmitButton>Record payable</SubmitButton>
        </ActionForm>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Outstanding</h2>
        {open.length === 0 ? (
          <EmptyState>Nothing owed. 🎉</EmptyState>
        ) : (
          <div className="space-y-4">
            {open.map((p) => (
              <div key={p.payable_id} className="rounded-xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{p.payee}</div>
                    <div className="text-xs text-gray-400">
                      {p.category ? `${p.category} · ` : ""}
                      {formatDate(p.incurred_date)}
                      {p.due_date ? ` · due ${formatDate(p.due_date)}` : ""}
                      {p.remarks ? ` · ${p.remarks}` : ""}
                    </div>
                    <div className="mt-1 text-xs text-gray-400">
                      {formatPeso(p.paid_centavos)} paid of {formatPeso(p.amount_centavos)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge tone="amber">{formatPeso(p.balance_centavos)}</Badge>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <ActionForm action={payPayable} className="flex flex-1 flex-wrap items-end gap-2">
                    <input type="hidden" name="payable_id" value={p.payable_id} />
                    <input type="hidden" name="paid_date" value={today} />
                    <div className="w-28">
                      <Field label="Pay ₱">
                        <Input type="number" step="0.01" min="0" inputMode="decimal" name="amount" required />
                      </Field>
                    </div>
                    <div className="min-w-[8rem] flex-1">
                      <Field label="From">
                        <Select name="cash_account_id" defaultValue={cashAccounts[0]?.id ?? ""}>
                          {cashAccounts.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <SubmitButton variant="secondary">Pay</SubmitButton>
                  </ActionForm>
                  {p.paid_centavos === 0 && (
                    <DeleteButton
                      action={voidPayable}
                      id={p.payable_id}
                      idField="payable_id"
                      confirmText="Void this payable? It will be reversed from the books."
                      className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                    >
                      Void
                    </DeleteButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {rows.some((r) => r.status === "paid") && (
        <Card>
          <h2 className="mb-3 font-semibold">Settled</h2>
          <div className="divide-y divide-gray-100">
            {rows
              .filter((r) => r.status === "paid")
              .map((p) => (
                <div key={p.payable_id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{p.payee}</div>
                    <div className="text-xs text-gray-400">
                      {p.category ? `${p.category} · ` : ""}
                      {formatDate(p.incurred_date)}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-gray-500">{formatPeso(p.amount_centavos)}</span>
                    <Badge tone="green">paid</Badge>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}
