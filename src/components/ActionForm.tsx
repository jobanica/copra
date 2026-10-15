"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { FormError } from "@/components/ui";

export interface ActionState {
  error?: string;
  message?: string;
}

export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction} className={className}>
      {state.error && <FormError message={state.error} />}
      {state.message && (
        <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
          {state.message}
        </div>
      )}
      {children}
    </form>
  );
}
