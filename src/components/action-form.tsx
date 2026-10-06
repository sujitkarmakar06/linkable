"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/server/actions/types";
import { Alert, Button } from "./ui";

export function SubmitButton({ children, variant }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant={variant}>
      {pending ? "Working..." : children}
    </Button>
  );
}

// A form wired to a server action that returns FormState; shows its messages.
export function ActionForm({
  action,
  submit,
  children,
  variant,
  className = "flex flex-col gap-4",
  id,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submit: ReactNode;
  children?: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form id={id} action={formAction} className={className}>
      {children}
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      {state?.ok && <Alert tone="success">{state.ok}</Alert>}
      <div>
        <SubmitButton variant={variant}>{submit}</SubmitButton>
      </div>
    </form>
  );
}
