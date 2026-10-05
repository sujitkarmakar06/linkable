import type { Metadata } from "next";
import { forgotPasswordAction } from "@/server/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Reset your password</h1>
      <p className="mb-5 text-sm text-muted">We&apos;ll email you a link to choose a new one.</p>
      <ActionForm action={forgotPasswordAction} submit="Send reset link">
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
      </ActionForm>
    </>
  );
}
