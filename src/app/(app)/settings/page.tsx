import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, Field, Input, EmptyState, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { updateSettings, updateBusiness, addGrade } from "./actions";
import { formatPeso } from "@/lib/money";
import type { Business, BusinessSettings, Grade, Profile } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isOwner(session.profile)) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: biz }, { data: settings }, { data: grades }, { data: profiles }] =
    await Promise.all([
      supabase.from("businesses").select("*").limit(1).maybeSingle(),
      supabase.from("business_settings").select("*").limit(1).maybeSingle(),
      supabase.from("grades").select("*").order("name"),
      supabase.from("profiles").select("*").order("created_at"),
    ]);

  const business = biz as Business | null;
  const s = settings as BusinessSettings | null;
  const gradeList = (grades ?? []) as Grade[];
  const people = (profiles ?? []) as Profile[];

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />

      <Card>
        <h2 className="mb-3 font-semibold">Business</h2>
        <ActionForm action={updateBusiness} className="space-y-3">
          <Field label="Name">
            <Input name="name" defaultValue={business?.name ?? ""} required />
          </Field>
          <Field label="Address">
            <Input name="address" defaultValue={business?.address ?? ""} />
          </Field>
          <SubmitButton>Save business</SubmitButton>
        </ActionForm>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Rules</h2>
        <ActionForm action={updateSettings} className="space-y-3">
          <Field
            label="Advance approval limit (₱)"
            hint="Cashier advances above this amount need owner approval."
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              name="advance_approval_limit"
              defaultValue={
                s ? (s.advance_approval_limit_centavos / 100).toFixed(2) : "5000.00"
              }
            />
          </Field>
          <Field
            label="Shrinkage threshold (%)"
            hint="Flag a truckload when shrinkage exceeds this (used in Phase 2)."
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              name="shrinkage_threshold_pct"
              defaultValue={s ? String(s.shrinkage_threshold_pct) : "3"}
            />
          </Field>
          <SubmitButton>Save rules</SubmitButton>
        </ActionForm>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Grades</h2>
        {gradeList.length === 0 ? (
          <EmptyState>No grades — purchases use a single ungraded price.</EmptyState>
        ) : (
          <div className="mb-3 flex flex-wrap gap-2">
            {gradeList.map((g) => (
              <Badge key={g.id}>{g.name}</Badge>
            ))}
          </div>
        )}
        <ActionForm action={addGrade} className="flex gap-2">
          <Input name="name" placeholder="New grade name" className="flex-1" />
          <SubmitButton variant="secondary">Add</SubmitButton>
        </ActionForm>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Users</h2>
        <div className="divide-y divide-gray-100">
          {people.map((pr) => (
            <div key={pr.id} className="flex items-center justify-between py-2 text-sm">
              <span>{pr.full_name || "—"}</span>
              <Badge tone={pr.role === "owner" ? "green" : "gray"}>{pr.role}</Badge>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-400">
          To add the cashier, have them create an account on the sign-in screen.
          The first account is the owner; the next becomes a cashier.
        </p>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Deleting records</h2>
        <p className="text-sm text-gray-500">
          To remove test data, delete records one at a time from their own
          pages (owner only): open a purchase, sale or farmer and use
          <strong> Delete</strong>, or delete an expense from Cash and a utang
          entry from the farmer&apos;s ledger. Deleting a farmer also removes
          that farmer&apos;s purchases and utang.
        </p>
      </Card>
    </div>
  );
}
