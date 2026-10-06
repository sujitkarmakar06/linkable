import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";

// Fixed-window rate limits stored in Postgres (no extra vendor). Good enough
// for login/signup/reset volumes; the daily job prunes old rows.

export const LIMITS = {
  loginEmail: { max: 5, minutes: 15 }, // failed logins per account
  loginIp: { max: 20, minutes: 15 }, // failed logins per IP
  signupIp: { max: 10, minutes: 60 },
  resetEmail: { max: 3, minutes: 60 },
  resetIp: { max: 10, minutes: 60 },
} as const;

type Limit = (typeof LIMITS)[keyof typeof LIMITS];

export function ipFrom(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function requestIp() {
  return ipFrom(await headers());
}

// Returns minutes until the caller may retry, or 0 if allowed.
// failuresOnly: count only failed attempts (logins); otherwise every attempt counts.
export async function limited(key: string, limit: Limit, { failuresOnly = false } = {}): Promise<number> {
  const since = new Date(Date.now() - limit.minutes * 60_000);
  const rows = await db.loginAttempt.findMany({
    where: { key, createdAt: { gte: since }, ...(failuresOnly ? { success: false } : {}) },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
    take: limit.max,
  });
  if (rows.length < limit.max) return 0;
  return Math.max(1, Math.ceil((rows[0].createdAt.getTime() + limit.minutes * 60_000 - Date.now()) / 60_000));
}

export async function recordAttempt(key: string, success = false) {
  await db.loginAttempt.create({ data: { key, success } });
}

export async function clearFailures(key: string) {
  await db.loginAttempt.deleteMany({ where: { key, success: false } });
}

export const tooMany = (minutes: number) => `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
