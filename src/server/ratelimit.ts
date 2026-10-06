import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";

// Fixed-window rate limits stored in Postgres (no extra vendor).
//
// Each attempt *reserves* its slot atomically (advisory lock per key, count,
// insert) before any slow work like bcrypt runs, so a burst of parallel
// requests can't all slip under the limit. A reservation is a failure until
// the caller marks it successful. The daily job prunes old rows.

export const LIMITS = {
  loginEmailIp: { max: 5, minutes: 15 }, // failed logins per account from one IP
  loginEmail: { max: 50, minutes: 15 }, // failed logins per account from all IPs (high: stops lockout abuse)
  loginIp: { max: 20, minutes: 15 }, // failed logins per IP
  signupIp: { max: 10, minutes: 60 },
  resetEmail: { max: 3, minutes: 60 },
  resetIp: { max: 10, minutes: 60 },
  twoFactor: { max: 5, minutes: 15 },
} as const;

type Limit = { max: number; minutes: number };
export type Check = { key: string; limit: Limit; failuresOnly?: boolean };

export function ipFrom(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function requestIp() {
  return ipFrom(await headers());
}

// Reserve one attempt on every key, or none if any key is over its limit.
// Returns minutes to wait (0 = allowed) and the reservation ids.
export async function reserve(checks: Check[]): Promise<{ wait: number; ids: string[] }> {
  return db.$transaction(async (tx) => {
    const sorted = [...checks].sort((a, b) => a.key.localeCompare(b.key)); // stable lock order
    for (const c of sorted) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"rl:" + c.key}))`;
    let wait = 0;
    for (const c of sorted) {
      const since = new Date(Date.now() - c.limit.minutes * 60_000);
      const rows = await tx.loginAttempt.findMany({
        where: { key: c.key, createdAt: { gte: since }, ...(c.failuresOnly ? { success: false } : {}) },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
        take: c.limit.max,
      });
      if (rows.length >= c.limit.max)
        wait = Math.max(wait, Math.max(1, Math.ceil((rows[0].createdAt.getTime() + c.limit.minutes * 60_000 - Date.now()) / 60_000)));
    }
    if (wait) return { wait, ids: [] };
    const ids: string[] = [];
    for (const c of sorted) ids.push((await tx.loginAttempt.create({ data: { key: c.key, success: false }, select: { id: true } })).id);
    return { wait: 0, ids };
  });
}

// The attempt succeeded: it no longer counts as a failure.
export async function succeeded(ids: string[]) {
  if (ids.length) await db.loginAttempt.updateMany({ where: { id: { in: ids } }, data: { success: true } });
}

export async function clearFailures(key: string) {
  await db.loginAttempt.deleteMany({ where: { key, success: false } });
}

export const loginChecks = (email: string, ip: string): Check[] => [
  { key: `login:email:${email}:ip:${ip}`, limit: LIMITS.loginEmailIp, failuresOnly: true },
  { key: `login:email:${email}`, limit: LIMITS.loginEmail, failuresOnly: true },
  { key: `login:ip:${ip}`, limit: LIMITS.loginIp, failuresOnly: true },
];

export const tooMany = (minutes: number) => `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
