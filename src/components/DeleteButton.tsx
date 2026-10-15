"use client";

import type { ReactNode } from "react";

/**
 * Owner-only hard-delete button: a tiny form that posts a hidden id to a
 * server action, guarded by a native confirmation prompt.
 */
export function DeleteButton({
  action,
  id,
  idField = "id",
  confirmText,
  children,
  className,
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  idField?: string;
  confirmText: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <input type="hidden" name={idField} value={id} />
      <button
        type="submit"
        className={
          className ??
          "rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white active:bg-red-700"
        }
      >
        {children}
      </button>
    </form>
  );
}
