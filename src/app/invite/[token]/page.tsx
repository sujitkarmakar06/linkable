import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { ROLE_LABEL } from "@/lib/roles";
import { acceptInviteAction } from "@/server/actions/workspace";
import { getSessionUser } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { Logo } from "@/components/logo";
import { Alert } from "@/components/ui";

export const metadata: Metadata = { title: "Workspace invite" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invite = await db.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { workspace: true } });
  const user = await getSessionUser();
  const valid = invite && !invite.acceptedAt && invite.expiresAt > new Date();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6">
        {!valid ? (
          <Alert tone="error">This invite is invalid or has expired. Ask for a new one.</Alert>
        ) : (
          <>
            <h1 className="mb-1 text-xl font-semibold">Join {invite.workspace.name}</h1>
            <p className="mb-5 text-sm text-muted">
              You&apos;ve been invited as {ROLE_LABEL[invite.role]} ({invite.email}).
            </p>
            {user ? (
              <ActionForm action={acceptInviteAction} submit="Accept invite">
                <input type="hidden" name="token" value={token} />
              </ActionForm>
            ) : (
              <p className="text-sm">
                <Link href="/login" className="text-accent">
                  Sign in
                </Link>{" "}
                or{" "}
                <Link href="/signup" className="text-accent">
                  create an account
                </Link>{" "}
                with {invite.email}, then open this link again.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
