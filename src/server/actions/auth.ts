"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { db } from "@/lib/db";
import { appUrl, sendEmail } from "@/lib/email";
import { hashPassword, verifyPassword } from "@/lib/password";
import { PLATFORM_ADMIN_EMAILS } from "@/lib/settings";
import { consumeAuthToken, issueAuthToken } from "@/lib/tokens";
import { verifySecondFactor } from "@/lib/totp";
import type { FormState } from "./types";

const email = z.string().trim().toLowerCase().email("Enter a valid email address");
const password = z.string().min(10, "Use at least 10 characters").max(200);

async function sendVerification(userId: string, to: string) {
  const token = await issueAuthToken(userId, "EMAIL_VERIFY");
  await sendEmail(to, "Verify your Linkable email", "Confirm your email", "Click the button to verify your email and finish setting up your account.", {
    label: "Verify email",
    url: appUrl(`/verify-email?token=${token}`),
  });
}

export async function signupAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({ name: z.string().trim().min(1, "Enter your name").max(80), email, password })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, email: addr } = parsed.data;

  const existing = await db.user.findUnique({ where: { email: addr } });
  if (existing) {
    // Same response either way so the form can't be used to probe accounts.
    if (!existing.emailVerified) await sendVerification(existing.id, addr);
    return { ok: "Check your inbox for a verification link." };
  }
  const user = await db.user.create({
    data: {
      name,
      email: addr,
      passwordHash: await hashPassword(parsed.data.password),
      platformRole: PLATFORM_ADMIN_EMAILS.includes(addr) ? "ADMIN" : "USER",
    },
  });
  await sendVerification(user.id, addr);
  return { ok: "Check your inbox for a verification link." };
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({ email, password: z.string().min(1, "Enter your password"), code: z.string().trim().optional() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email: addr, password: pw, code } = parsed.data;

  const user = await db.user.findUnique({ where: { email: addr } });
  if (!user?.passwordHash || !(await verifyPassword(pw, user.passwordHash))) return { error: "Email or password is incorrect." };
  if (user.suspendedAt) return { error: "This account is suspended. Contact support." };
  if (!user.emailVerified) {
    await sendVerification(user.id, addr);
    return { error: "Please verify your email first. We've sent you a new link." };
  }
  if (user.twoFactorEnabled) {
    if (!code) return { needsCode: true };
    if (!(await verifySecondFactor(user, code, false))) return { needsCode: true, error: "That code didn't work. Try again." };
  }

  try {
    await signIn("credentials", { email: addr, password: pw, code: code ?? "", redirectTo: "/app" });
  } catch (err) {
    if (err instanceof AuthError) return { error: "Sign-in failed. Please try again." };
    throw err; // NEXT_REDIRECT on success
  }
}

export async function googleSignInAction() {
  await signIn("google", { redirectTo: "/app" });
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}

export async function verifyEmailAction(_: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const userId = await consumeAuthToken(token, "EMAIL_VERIFY");
  if (!userId) return { error: "This link is invalid or has expired. Sign in to get a new one." };
  await db.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
  redirect("/login?verified=1");
}

export async function forgotPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const user = await db.user.findUnique({ where: { email: parsed.data } });
  if (user && !user.suspendedAt) {
    const token = await issueAuthToken(user.id, "PASSWORD_RESET");
    await sendEmail(user.email, "Reset your Linkable password", "Reset your password", "This link expires in 1 hour. If you didn't ask for it, ignore this email.", {
      label: "Choose a new password",
      url: appUrl(`/reset-password?token=${token}`),
    });
  }
  return { ok: "If that email has an account, a reset link is on its way." };
}

export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({ token: z.string().min(1), password }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const userId = await consumeAuthToken(parsed.data.token, "PASSWORD_RESET");
  if (!userId) return { error: "This link is invalid or has expired." };
  // A reset proves inbox access, so the email counts as verified too.
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(parsed.data.password), emailVerified: new Date() },
  });
  redirect("/login?reset=1");
}
