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
// afterTimeStep rejects a code from a step that was already used (replay).
export async function verifyTotp(secret: string, token: string, afterTimeStep?: number | null): Promise<{ valid: boolean; timeStep?: number }> {
  if (!/^\d{6}$/.test(token)) return { valid: false };
  const result = await verify({ secret, token, epochTolerance: 30, ...(afterTimeStep != null ? { afterTimeStep } : {}) });
  return { valid: result.valid, timeStep: (result as { timeStep?: number }).timeStep };
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
  user: { id: string; twoFactorSecret: string | null; lastTotpStep?: number | null },
  code: string,
  consume: boolean,
): Promise<boolean> {
  const value = code.trim().toLowerCase();
  if (!value || !user.twoFactorSecret) return false;
  if (/^\d{6}$/.test(value)) {
    const r = await verifyTotp(decrypt(user.twoFactorSecret), value, user.lastTotpStep);
    if (!r.valid || r.timeStep == null) return false;
    if (!consume) return true;
    // Record the step atomically; a concurrent use of the same code loses.
    const { count } = await db.user.updateMany({
      where: { id: user.id, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: r.timeStep } }] },
      data: { lastTotpStep: r.timeStep },
    });
    return count === 1;
  }
  const codes = await db.recoveryCode.findMany({ where: { userId: user.id, usedAt: null } });
  for (const rc of codes) {
    if (await bcrypt.compare(value, rc.codeHash)) {
      if (!consume) return true;
      const { count } = await db.recoveryCode.updateMany({ where: { id: rc.id, usedAt: null }, data: { usedAt: new Date() } });
      return count === 1;
    }
  }
  return false;
}
