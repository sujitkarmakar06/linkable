"use client";

import { useActionState, useState, useTransition } from "react";
import { confirmTwoFactorAction, disableTwoFactorAction, startTwoFactorAction } from "@/server/actions/security";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Button, Field, Input } from "@/components/ui";

export function TwoFactor({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();
  const [confirmState, confirmAction] = useActionState(confirmTwoFactorAction, undefined);
  const codes = confirmState?.data?.codes as string[] | undefined;

  if (codes) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="success">Two-factor authentication is on.</Alert>
        <p className="text-sm">Save these recovery codes somewhere safe. Each one works once if you lose your phone. They won&apos;t be shown again. After this you&apos;ll be asked to sign in again with your code.</p>
        <pre className="rounded-md border border-border bg-bg p-3 font-mono text-sm leading-7">{codes.join("\n")}</pre>
      </div>
    );
  }

  if (enabled) {
    return (
      <ActionForm action={disableTwoFactorAction} submit="Turn off 2FA" variant="danger">
        <p className="text-sm text-success">Two-factor authentication is on.</p>
        <Field label="Code to confirm" hint="From your authenticator app, or a recovery code.">
          <Input name="code" autoComplete="one-time-code" required />
        </Field>
      </ActionForm>
    );
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">Use an authenticator app (Google Authenticator, 1Password, Authy) for a code at every sign-in.</p>
        {startError && <Alert tone="error">{startError}</Alert>}
        <div>
          <Button
            disabled={starting}
            onClick={() =>
              startTransition(async () => {
                const res = await startTwoFactorAction();
                if ("error" in res) setStartError(res.error);
                else setSetup(res);
              })
            }
          >
            {starting ? "Working..." : "Set up 2FA"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={confirmAction} className="flex flex-col gap-4">
      <p className="text-sm">Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimise */}
      <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-md bg-white p-2" />
      <p className="text-xs text-muted">
        Can&apos;t scan? Enter this key: <code className="font-mono">{setup.secret}</code>
      </p>
      <Field label="6-digit code">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" required />
      </Field>
      {confirmState?.error && <Alert tone="error">{confirmState.error}</Alert>}
      <div>
        <SubmitButton>Turn on 2FA</SubmitButton>
      </div>
    </form>
  );
}
