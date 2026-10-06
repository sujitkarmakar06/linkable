import type { PlatformSettings } from "@prisma/client";
import { db } from "./db";
import { DEFAULT_CREDIT_TIERS, type CreditTier } from "./credits";

export const DEFAULT_BANNED_NICHES = ["casino", "gambling", "adult", "pharma", "cbd", "crypto", "loans"];

export const PLATFORM_ADMIN_EMAILS = (process.env.PLATFORM_ADMIN_EMAILS ?? "sujitk@solguruz.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export async function getSettings(): Promise<PlatformSettings & { creditTiers: CreditTier[] }> {
  const row = await db.platformSettings.upsert({
    where: { id: "global" },
    update: {},
    create: {
      id: "global",
      bannedNiches: DEFAULT_BANNED_NICHES,
      creditTiers: DEFAULT_CREDIT_TIERS,
    },
  });
  return { ...row, creditTiers: row.creditTiers as CreditTier[] };
}

export const priceRules = (s: { creditTiers: CreditTier[]; nofollowMultiplier: number; guestPostBonus: number }) => ({
  tiers: s.creditTiers,
  nofollowMultiplier: s.nofollowMultiplier,
  guestPostBonus: s.guestPostBonus,
});
