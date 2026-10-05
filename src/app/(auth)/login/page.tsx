import Link from "next/link";
import type { Metadata } from "next";
import { googleEnabled } from "@/auth";
import { googleSignInAction } from "@/server/actions/auth";
import { Alert, Button } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  OAuthAccountNotLinked: "This email already has a password account. Sign in with your password instead.",
  AccessDenied: "Google sign-in was refused. Your Google email must be verified and your account active.",
  "2fa_password": "This account uses two-factor authentication. Sign in with your password and code.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? (ERRORS[params.error] ?? "Sign-in failed. Please try again.") : null;
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Sign in</h1>
      <p className="mb-5 text-sm text-muted">
        New here?{" "}
        <Link href="/signup" className="text-accent">
          Create an account
        </Link>
      </p>
      <div className="mb-4 flex flex-col gap-2">
        {params.verified && <Alert tone="success">Email verified. You can sign in now.</Alert>}
        {params.reset && <Alert tone="success">Password changed. Sign in with your new password.</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
      {googleEnabled && (
        <>
          <form action={googleSignInAction}>
            <Button variant="secondary" className="w-full">
              Continue with Google
            </Button>
          </form>
          <div className="my-4 text-center text-xs text-muted">or</div>
        </>
      )}
      <LoginForm />
    </>
  );
}
