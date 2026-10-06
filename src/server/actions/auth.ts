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
import { clearFailures, LIMITS, loginChecks, requestIp, reserve, succeeded, tooMany } from "@/server/ratelimit";
import type { FormState } from "./types";

// bcrypt hash of a random string, compared when no account matches.
const DUMMY_HASH = "$2b$12$FHgIHzc0HEo9Jb3w1gGYze5tTOk.iCG.EOaa6cQxgZPOqvPFc8Xtu";
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
    .object({ name: z.string().trim().min(1, "Enter your name").max(80), email, password, terms: z.boolean() })
    .safeParse({ ...Object.fromEntries(form), terms: form.get("terms") === "on" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, email: addr } = parsed.data;
  const { wait } = await reserve([{ key: `signup:ip:${await requestIp()}`, limit: LIMITS.signupIp }]);
  if (wait) return { error: tooMany(wait) };
  if (!parsed.data.terms) return { error: "Please accept the Terms of Service and Privacy Policy." };

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
      termsAcceptedAt: new Date(),
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

  const checks = loginChecks(addr, await requestIp());
  // Reserved before bcrypt runs; stays counted as a failure unless the login succeeds.
  const slot = await reserve(checks);
  if (slot.wait) return { error: tooMany(slot.wait) };
  const fail = async (state: FormState) => state;

  const user = await db.user.findUnique({ where: { email: addr } });
  // Always run bcrypt so response time doesn't reveal whether the account exists.
  const ok = await verifyPassword(pw, user?.passwordHash ?? DUMMY_HASH);
  if (!user?.passwordHash || !ok) return fail({ error: "Email or password is incorrect." });
  if (user.suspendedAt) return { error: "This account is suspended. Contact support." };
  if (!user.emailVerified) {
    await sendVerification(user.id, addr);
    return { error: "Please verify your email first. We've sent you a new link." };
  }
  if (user.twoFactorEnabled) {
    // Correct password, code still to come: not a failed attempt.
    if (!code) {
      await succeeded(slot.ids);
      return { needsCode: true };
    }
    if (!(await verifySecondFactor(user, code, false))) return fail({ needsCode: true, error: "That code didn't work. Try again." });
  }
  await succeeded(slot.ids);
  await clearFailures(checks[0].key);

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
  const { wait } = await reserve([
    { key: `reset:email:${parsed.data}`, limit: LIMITS.resetEmail },
    { key: `reset:ip:${await requestIp()}`, limit: LIMITS.resetIp },
  ]);
  if (wait) return { error: tooMany(wait) };
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
    data: { passwordHash: await hashPassword(parsed.data.password), emailVerified: new Date(), sessionVersion: { increment: 1 } },
  });
  redirect("/login?reset=1");
}
