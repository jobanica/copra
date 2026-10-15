import { PageHeader, Card, Field, Input, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { createFarmer } from "../actions";

export default function NewFarmerPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="New farmer" />
      <Card>
        <ActionForm action={createFarmer} className="space-y-3">
          <Field label="Name">
            <Input name="name" required autoFocus />
          </Field>
          <Field label="Barangay">
            <Input name="barangay" />
          </Field>
          <Field label="Mobile number">
            <Input name="mobile" inputMode="tel" />
          </Field>
          <Field label="Notes">
            <Textarea name="notes" rows={3} />
          </Field>
          <SubmitButton>Save farmer</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
