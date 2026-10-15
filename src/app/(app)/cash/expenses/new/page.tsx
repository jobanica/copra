import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { PageHeader, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { recordExpense } from "../../actions";
import { manilaToday } from "@/lib/format";
import type { GlAccount, CashAccount } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function NewExpensePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const supabase = await createClient();
  const [{ data: gl }, { data: cash }] = await Promise.all([
    supabase.from("gl_accounts").select("*").eq("type", "expense").eq("active", true).order("sort_order"),
    supabase.from("cash_accounts").select("*").eq("active", true).order("type"),
  ]);
  const expenseAccounts = (gl ?? []) as GlAccount[];
  const cashAccounts = (cash ?? []) as CashAccount[];

  return (
    <div className="space-y-4">
      <PageHeader title="Record expense" />
      <Card>
        <ActionForm action={recordExpense} className="space-y-3">
          <Field label="Category">
            <Select name="expense_account_id" required>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Paid from">
            <Select name="cash_account_id" required>
              {cashAccounts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₱)">
              <Input type="number" step="0.01" min="0" inputMode="decimal" name="amount" required autoFocus />
            </Field>
            <Field label="Date">
              <Input type="date" name="expense_date" defaultValue={manilaToday()} />
            </Field>
          </div>
          <Field label="Remarks">
            <Textarea name="remarks" rows={2} />
          </Field>
          <SubmitButton className="w-full">Save expense</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
