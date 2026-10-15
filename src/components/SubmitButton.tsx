"use client";

import { useFormStatus } from "react-dom";
import { clsx } from "clsx";
import type { ReactNode } from "react";

export function SubmitButton({
  children,
  variant = "primary",
  className,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  const { pending } = useFormStatus();
  const cls =
    variant === "danger"
      ? "btn-danger"
      : variant === "secondary"
        ? "btn-secondary"
        : "btn-primary";
  return (
    <button type="submit" disabled={pending} className={clsx(cls, className)}>
      {pending ? "Saving…" : children}
    </button>
  );
}
