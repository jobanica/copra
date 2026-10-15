import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Field, Input, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { updateFarmer } from "../../actions";
import type { Farmer } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function EditFarmerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("farmers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const farmer = data as Farmer;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Edit farmer"
        subtitle={farmer.name}
        action={
          <Link href={`/farmers/${id}`} className="btn-secondary">
            Cancel
          </Link>
        }
      />
      <Card>
        <ActionForm action={updateFarmer} className="space-y-3">
          <input type="hidden" name="farmer_id" value={id} />
          <Field label="Name">
            <Input name="name" defaultValue={farmer.name} required autoFocus />
          </Field>
          <Field label="Barangay">
            <Input name="barangay" defaultValue={farmer.barangay ?? ""} />
          </Field>
          <Field label="Mobile number">
            <Input
              name="mobile"
              inputMode="tel"
              defaultValue={farmer.mobile ?? ""}
            />
          </Field>
          <Field label="Notes">
            <Textarea name="notes" rows={3} defaultValue={farmer.notes ?? ""} />
          </Field>
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
