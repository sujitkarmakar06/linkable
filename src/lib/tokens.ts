import type { AuthTokenType } from "@prisma/client";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";

const TTL_MINUTES: Record<AuthTokenType, number> = { EMAIL_VERIFY: 60 * 24, PASSWORD_RESET: 60 };

export async function issueAuthToken(userId: string, type: AuthTokenType): Promise<string> {
  const token = randomToken();
  await db.authToken.deleteMany({ where: { userId, type, usedAt: null } });
  await db.authToken.create({
    data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MINUTES[type] * 60_000) },
  });
  return token;
}

// Returns the userId and marks the token used, or null if invalid/expired.
export async function consumeAuthToken(token: string, type: AuthTokenType): Promise<string | null> {
  const row = await db.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) return null;
  const { count } = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  return count === 1 ? row.userId : null;
}
