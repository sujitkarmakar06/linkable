"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/server/session";
import type { FormState } from "./types";

const mode = z.enum(["INSTANT", "DIGEST", "OFF"]);

export async function updateEmailPrefsAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ emailDeals: mode, emailMessages: mode, emailSites: mode, monthlyReport: z.boolean() })
    .safeParse({ ...Object.fromEntries(form), monthlyReport: form.get("monthlyReport") === "on" });
  if (!parsed.success) return { error: "Pick an option for each kind of email." };
  await db.user.update({ where: { id: user.id }, data: parsed.data });
  return { ok: "Email preferences saved." };
}

export async function markAllReadAction() {
  const user = await requireUser();
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/app", "layout");
}
