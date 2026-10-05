"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { isNiche } from "@/lib/niches";
import { getSettings } from "@/lib/settings";
import { urlOnDomain } from "@/lib/terms";
import { runMatchingForRequest } from "@/server/matching";
import { requireMembership } from "@/server/session";
import type { FormState } from "./types";

export async function createLinkRequestAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireMembership("MEMBER");
  const settings = await getSettings();
  const parsed = z
    .object({
      siteId: z.string().min(1, "Choose the site that should receive the link"),
      targetUrl: z.string().trim().min(1, "Enter the page URL"),
      anchors: z
        .string()
        .transform((s) => [...new Set(s.split("\n").map((a) => a.trim()).filter(Boolean))])
        .pipe(z.array(z.string().max(100, "Each anchor is at most 100 characters")).min(1, "Add at least one anchor").max(5, "At most 5 anchors")),
      placementType: z.enum(["INSERTION", "GUEST_POST"]),
      rel: z.enum(["DOFOLLOW", "NOFOLLOW"]),
      minDomainRating: z.coerce.number().int().min(settings.minDomainRating, `Minimum DR can't be below ${settings.minDomainRating}`).max(100),
      niches: z.array(z.string().refine(isNiche)).max(5, "Pick up to 5 niches"),
      maxCredits: z.coerce.number().int().min(1, "Offer at least 1 credit").max(100),
      autoMatch: z.boolean(),
    })
    .safeParse({ ...Object.fromEntries(form), niches: form.getAll("niches"), autoMatch: form.get("autoMatch") === "on" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;

  const site = await db.site.findFirst({ where: { id: data.siteId, workspaceId: workspace.id, status: "APPROVED", canReceive: true } });
  if (!site) return { error: "Pick one of your approved sites that receives links." };
  if (!urlOnDomain(data.targetUrl, site.domain)) return { error: `The target URL must be a page on ${site.domain}.` };
  if (workspace.plan === "FREE") {
    const open = await db.linkRequest.count({ where: { workspaceId: workspace.id, status: { in: ["OPEN", "MATCHED"] } } });
    if (open >= settings.freeMaxOpenRequests) return { error: `The free plan allows ${settings.freeMaxOpenRequests} open link requests at a time.` };
  }
  const req = await db.linkRequest.create({ data: { ...data, workspaceId: workspace.id } });
  await db.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: "request.created", target: req.id } });
  if (req.autoMatch) after(() => runMatchingForRequest(req.id).catch((err) => console.error("[matching]", err)));
  redirect(`/app/requests/${req.id}`);
}

export async function cancelLinkRequestAction(form: FormData) {
  const { user, workspace } = await requireMembership("MEMBER");
  const id = String(form.get("requestId"));
  const { count } = await db.linkRequest.updateMany({ where: { id, workspaceId: workspace.id, status: "OPEN" }, data: { status: "CANCELLED" } });
  if (count) {
    // Pending offers on a cancelled request can't be accepted any more.
    await db.proposal.updateMany({ where: { linkRequestId: id, status: "OPEN" }, data: { status: "DECLINED" } });
    await db.match.updateMany({ where: { linkRequestId: id, status: "OFFERED" }, data: { status: "EXPIRED" } });
    await db.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: "request.cancelled", target: id } });
  }
  revalidatePath(`/app/requests/${id}`);
  revalidatePath("/app/requests");
}
