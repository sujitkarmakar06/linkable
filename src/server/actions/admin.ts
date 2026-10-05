"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/session";
import type { FormState } from "./types";

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const settingsSchema = z.object({
  minDomainRating: int(0, 100),
  minMonthlyTraffic: int(0, 100_000_000),
  bannedNiches: z.string().transform((s) => [...new Set(s.split(",").map((n) => n.trim().toLowerCase()).filter(Boolean))]),
  starterCredits: int(0, 100),
  freeMaxSites: int(1, 1000),
  freeMaxOpenRequests: int(1, 1000),
  guaranteeMonths: int(1, 60),
  checkIntervalDays: int(1, 90),
  graceDays: int(0, 60),
  removalPenaltyCredits: int(0, 100),
  pairCooldownMonths: int(0, 60),
});

export async function updateSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = settingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: `${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}` };
  await db.platformSettings.update({ where: { id: "global" }, data: { ...parsed.data, updatedById: admin.id } });
  await db.auditLog.create({ data: { actorId: admin.id, action: "admin.settings_updated", meta: parsed.data } });
  revalidatePath("/admin");
  return { ok: "Rules saved." };
}
