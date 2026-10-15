import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, Field, Input, Select } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { addAccount } from "../actions";
import { formatPeso } from "@/lib/money";
import type { AccountBalanceView, AccountType } from "@/types/db";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<AccountType, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};
const ORDER: AccountType[] = ["asset", "liability", "equity", "income", "expense"];

export default async function ChartPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isOwner(session.profile)) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase.from("v_account_balances").select("*").order("sort_order");
  const accounts = (data ?? []) as AccountBalanceView[];

  return (
    <div className="space-y-4">
      <PageHeader title="Chart of accounts" />

      {ORDER.map((type) => {
        const group = accounts.filter((a) => a.type === type);
        if (group.length === 0) return null;
        return (
          <Card key={type}>
            <h2 className="mb-2 text-xs font-semibold uppercase text-gray-400">{TYPE_LABEL[type]}</h2>
            <div className="divide-y divide-gray-100">
              {group.map((a) => (
                <div key={a.account_id} className="flex items-center justify-between py-1.5 text-sm">
                  <span>
                    <span className="text-gray-400">{a.code}</span> {a.name}
                  </span>
                  <span className={a.balance_centavos === 0 ? "text-gray-300" : "font-medium"}>
                    {formatPeso(a.balance_centavos)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        );
      })}

      <Card>
        <h2 className="mb-3 font-semibold">Add account</h2>
        <ActionForm action={addAccount} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code">
              <Input name="code" placeholder="e.g. 6500" required />
            </Field>
            <Field label="Type">
              <Select name="type" defaultValue="expense">
                <option value="asset">Asset</option>
                <option value="liability">Liability</option>
                <option value="equity">Equity</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </Select>
            </Field>
          </div>
          <Field label="Name">
            <Input name="name" required />
          </Field>
          <SubmitButton variant="secondary">Add account</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
