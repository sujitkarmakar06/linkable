import { generateSecret, generateURI, verify } from "otplib";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { decrypt } from "./crypto";

export { generateSecret };

export function totpUri(email: string, secret: string) {
  return generateURI({ issuer: "Linkable", label: email, secret });
}

// Accept the previous/next 30s step to absorb clock drift on phones.
export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  if (!/^\d{6}$/.test(token)) return false;
  const result = await verify({ secret, token, epochTolerance: 30 });
  return result.valid;
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString("hex"); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export const hashRecoveryCode = (code: string) => bcrypt.hash(code.toLowerCase(), 10);

// Checks a 6-digit TOTP code or an unused recovery code.
// With consume=true a matching recovery code is marked used.
export async function verifySecondFactor(
  user: { id: string; twoFactorSecret: string | null },
  code: string,
  consume: boolean,
): Promise<boolean> {
  const value = code.trim().toLowerCase();
  if (!value || !user.twoFactorSecret) return false;
  if (/^\d{6}$/.test(value)) return verifyTotp(decrypt(user.twoFactorSecret), value);
  const codes = await db.recoveryCode.findMany({ where: { userId: user.id, usedAt: null } });
  for (const rc of codes) {
    if (await bcrypt.compare(value, rc.codeHash)) {
      if (consume) await db.recoveryCode.update({ where: { id: rc.id }, data: { usedAt: new Date() } });
      return true;
    }
  }
  return false;
}
