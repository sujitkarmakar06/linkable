"use server";

import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { hashPassword, verifyPassword } from "@/lib/password";
import { generateRecoveryCodes, generateSecret, hashRecoveryCode, totpUri, verifySecondFactor, verifyTotp } from "@/lib/totp";
import { requireUser } from "@/server/session";
import { LIMITS, reserve, succeeded, tooMany } from "@/server/ratelimit";
import type { FormState } from "./types";

// Step 1: create a pending secret and return the QR code. 2FA is not on
// until the user proves they can generate a code (step 2).
export async function startTwoFactorAction(): Promise<{ qr: string; secret: string } | { error: string }> {
  const user = await requireUser();
  if (user.twoFactorEnabled) return { error: "Two-factor authentication is already on." };
  // 2FA is enforced on the password sign-in, so a password must exist first.
  if (!user.passwordHash) return { error: "Set a password first, then turn on 2FA." };
  const secret = generateSecret();
  await db.user.update({ where: { id: user.id }, data: { twoFactorSecret: encrypt(secret) } });
  const qr = await QRCode.toDataURL(totpUri(user.email, secret));
  return { qr, secret };
}

export async function confirmTwoFactorAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.twoFactorSecret) return { error: "Start setup again." };
  const code = String(form.get("code") ?? "").trim();
  const check = await verifyTotp(decrypt(user.twoFactorSecret), code);
  if (!check.valid) return { error: "That code didn't match. Check your phone's clock and try again." };
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map(hashRecoveryCode));
  await db.$transaction([
    db.recoveryCode.deleteMany({ where: { userId: user.id } }),
    db.recoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: user.id, codeHash })) }),
    db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true, lastTotpStep: check.timeStep ?? null, sessionVersion: { increment: 1 } } }),
    db.auditLog.create({ data: { actorId: user.id, action: "user.2fa_enabled" } }),
  ]);
  // Every session (this one included) must sign in again with 2FA. No revalidate
  // here, so the recovery codes are shown before that happens.
  return { ok: "Two-factor authentication is on.", data: { codes } };
}

export async function disableTwoFactorAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.twoFactorEnabled) return { error: "Two-factor authentication is already off." };
  const code = String(form.get("code") ?? "");
  const slot = await reserve([{ key: `2fa:user:${user.id}`, limit: LIMITS.twoFactor, failuresOnly: true }]);
  if (slot.wait) return { error: tooMany(slot.wait) };
  if (!(await verifySecondFactor(user, code, true))) return { error: "Enter a valid code from your app or a recovery code." };
  await succeeded(slot.ids);
  await db.$transaction([
    db.recoveryCode.deleteMany({ where: { userId: user.id } }),
    db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false, twoFactorSecret: null, lastTotpStep: null, sessionVersion: { increment: 1 } } }),
    db.auditLog.create({ data: { actorId: user.id, action: "user.2fa_disabled" } }),
  ]);
  return { ok: "Two-factor authentication is off. Please sign in again." };
}

export async function updateProfileAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = z.string().trim().min(1, "Enter your name").max(80).safeParse(form.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };
  await db.user.update({ where: { id: user.id }, data: { name: name.data } });
  revalidatePath("/app", "layout");
  return { ok: "Saved." };
}

export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ current: z.string().optional(), next: z.string().min(10, "Use at least 10 characters").max(200) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  // Google-only accounts have no password yet; let them set one.
  if (user.passwordHash && !(await verifyPassword(parsed.data.current ?? "", user.passwordHash))) return { error: "Current password is incorrect." };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.next), sessionVersion: { increment: 1 } } });
  await db.auditLog.create({ data: { actorId: user.id, action: "user.password_changed" } });
  return { ok: "Password updated. You've been signed out everywhere - sign in again with your new password." };
}
