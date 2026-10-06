import Link from "next/link";
import type { Metadata } from "next";
import { googleEnabled } from "@/auth";
import { googleSignInAction, signupAction } from "@/server/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Button, Field, Input } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Create your account</h1>
      <p className="mb-5 text-sm text-muted">
        Already have one?{" "}
        <Link href="/login" className="text-accent">
          Sign in
        </Link>
      </p>
      {googleEnabled && (
        <>
          <form action={googleSignInAction}>
            <Button variant="secondary" className="w-full">
              Sign up with Google
            </Button>
          </form>
          <div className="my-4 text-center text-xs text-muted">or</div>
        </>
      )}
      <ActionForm action={signupAction} submit="Create account">
        <Field label="Name">
          <Input name="name" autoComplete="name" required />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          <PasswordInput name="password" autoComplete="new-password" minLength={10} required />
        </Field>
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
            , including the search-engine risk described there.
          </span>
        </label>
      </ActionForm>
    </>
  );
}
