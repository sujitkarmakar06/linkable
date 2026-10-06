"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { loginAction } from "@/server/actions/auth";
import { SubmitButton } from "@/components/action-form";
import { Alert, Field, Input } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, undefined);
  // Controlled so values survive React's form reset between the two steps.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="flex flex-col gap-4">
      {/* Keep email/password on the 2FA step so the second submit has them. */}
      <div className={state?.needsCode ? "hidden" : "flex flex-col gap-4"}>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <PasswordInput name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </div>
      {state?.needsCode && (
        <Field label="Authentication code" hint="6-digit code from your authenticator app, or a recovery code.">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required />
        </Field>
      )}
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      <SubmitButton>{state?.needsCode ? "Verify" : "Sign in"}</SubmitButton>
      <Link href="/forgot-password" className="text-center text-sm text-muted hover:text-text">
        Forgot password?
      </Link>
    </form>
  );
}
