import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createWorkspaceAction } from "@/server/actions/workspace";
import { getCurrentMembership, requireUser } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { Logo } from "@/components/logo";
import { Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Create a workspace" };

export default async function OnboardingPage() {
  const user = await requireUser();
  if (await getCurrentMembership()) redirect("/app");
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6">
        <h1 className="mb-1 text-xl font-semibold">Welcome{user.name ? `, ${user.name}` : ""}</h1>
        <p className="mb-5 text-sm text-muted">Create a workspace for your company or agency. You can invite your team afterwards.</p>
        <ActionForm action={createWorkspaceAction} submit="Create workspace">
          <Field label="Workspace name">
            <Input name="name" placeholder="Acme Marketing" required minLength={2} maxLength={60} />
          </Field>
          {!user.termsAcceptedAt && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="terms" required className="mt-1" />
              <span>
                I agree to the{" "}
                <a href="/terms" target="_blank" className="text-accent">
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href="/privacy" target="_blank" className="text-accent">
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          )}
        </ActionForm>
      </div>
    </main>
  );
}
