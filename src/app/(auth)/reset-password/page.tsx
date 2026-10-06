import type { Metadata } from "next";
import { resetPasswordAction } from "@/server/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Alert, Field } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  if (typeof token !== "string") return <Alert tone="error">This reset link is incomplete.</Alert>;
  return (
    <>
      <h1 className="mb-5 text-xl font-semibold">Choose a new password</h1>
      <ActionForm action={resetPasswordAction} submit="Save password">
        <input type="hidden" name="token" value={token} />
        <Field label="New password" hint="At least 10 characters.">
          <PasswordInput name="password" autoComplete="new-password" minLength={10} required />
        </Field>
      </ActionForm>
    </>
  );
}
