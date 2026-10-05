import type { Metadata } from "next";
import { changePasswordAction, updateProfileAction } from "@/server/actions/security";
import { requireUser } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { TwoFactor } from "./two-factor";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Account" description={user.email} />
      <div className="flex max-w-xl flex-col gap-4">
        <Card title="Profile">
          <ActionForm action={updateProfileAction} submit="Save">
            <Field label="Name">
              <Input name="name" defaultValue={user.name ?? ""} required />
            </Field>
          </ActionForm>
        </Card>
        <Card title={user.passwordHash ? "Change password" : "Set a password"} description={user.passwordHash ? undefined : "You signed up with Google. Add a password to also sign in with email."}>
          <ActionForm action={changePasswordAction} submit="Update password">
            {user.passwordHash && (
              <Field label="Current password">
                <Input name="current" type="password" autoComplete="current-password" required />
              </Field>
            )}
            <Field label="New password" hint="At least 10 characters.">
              <Input name="next" type="password" autoComplete="new-password" minLength={10} required />
            </Field>
          </ActionForm>
        </Card>
        <Card title="Two-factor authentication">
          <TwoFactor enabled={user.twoFactorEnabled} />
        </Card>
      </div>
    </>
  );
}
