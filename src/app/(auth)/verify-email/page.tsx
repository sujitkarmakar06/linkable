import type { Metadata } from "next";
import { verifyEmailAction } from "@/server/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Alert } from "@/components/ui";

export const metadata: Metadata = { title: "Verify email" };

// Verification needs a click (POST) so link scanners that prefetch email
// links can't use up the token.
export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const { token } = await searchParams;
  if (typeof token !== "string") return <Alert tone="error">This verification link is incomplete.</Alert>;
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Verify your email</h1>
      <p className="mb-5 text-sm text-muted">One click and you&apos;re in.</p>
      <ActionForm action={verifyEmailAction} submit="Verify my email">
        <input type="hidden" name="token" value={token} />
      </ActionForm>
    </>
  );
}
