"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { assessSite, grantStarterCreditsOnce, notifySiteDecision } from "@/server/sites";
import { runMatching } from "@/server/matching";
import { requireAdmin } from "@/server/session";
import type { FormState } from "./types";

// Decisions move the site to another tab, removing its card, so the result
// is shown as a banner on the tab the admin was on.
const done = (form: FormData, message: string): never => {
  revalidatePath("/admin/sites");
  revalidatePath("/admin");
  const tab = String(form.get("tab") ?? "PENDING_REVIEW");
  redirect(`/admin/sites?${new URLSearchParams({ status: tab, msg: message })}`);
};

export async function approveSiteAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const site = await db.site.findUnique({ where: { id: String(form.get("siteId")) } });
  if (!site || !site.verifiedAt) return { error: "Only verified sites can be approved." };
  if (site.domainRating == null || site.organicTraffic == null) return { error: "Enter DR and traffic before approving." };
  const settings = await getSettings();
  const note = String(form.get("note") ?? "").trim() || null;

  let granted = false;
  await db.$transaction(async (tx) => {
    await tx.site.update({ where: { id: site.id }, data: { status: "APPROVED", reviewNote: note, reviewedAt: new Date(), reviewedById: admin.id } });
    granted = await grantStarterCreditsOnce(tx, site.workspaceId, settings.starterCredits, admin.id);
    await tx.auditLog.create({ data: { actorId: admin.id, workspaceId: site.workspaceId, action: "admin.site_approved", target: site.id, meta: { granted } } });
  });
  // A newly approved giver site may fit requests that are waiting.
  if (site.canGive) after(() => runMatching().catch((err) => console.error("[matching]", err)));
  await notifySiteDecision(site.workspaceId, site.domain, site.id, "approved", granted ? `${settings.starterCredits} starter credits were added to your workspace.` : null);
  return done(form, `${site.domain} approved${granted ? ` and ${settings.starterCredits} starter credits granted` : ""}.`);
}

export async function rejectSiteAction(_: FormState, form: FormData): Promise<FormState> {
  return decide(form, "REJECTED");
}

export async function suspendSiteAction(_: FormState, form: FormData): Promise<FormState> {
  return decide(form, "SUSPENDED");
}

async function decide(form: FormData, status: "REJECTED" | "SUSPENDED"): Promise<FormState> {
  const admin = await requireAdmin();
  const site = await db.site.findUnique({ where: { id: String(form.get("siteId")) } });
  if (!site) return { error: "Site not found." };
  const note = String(form.get("note") ?? "").trim();
  if (!note) return { error: "Add a reason - the site owner will see it." };
  await db.site.update({ where: { id: site.id }, data: { status, reviewNote: note, reviewedAt: new Date(), reviewedById: admin.id } });
  await db.auditLog.create({ data: { actorId: admin.id, workspaceId: site.workspaceId, action: `admin.site_${status.toLowerCase()}`, target: site.id, meta: { note } } });
  await notifySiteDecision(site.workspaceId, site.domain, site.id, status === "REJECTED" ? "rejected" : "suspended", note);
  return done(form, `${site.domain} ${status === "REJECTED" ? "rejected" : "suspended"}.`);
}

export async function setSiteMetricsAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ siteId: z.string(), domainRating: z.coerce.number().int().min(0).max(100), organicTraffic: z.coerce.number().int().min(0) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "DR must be 0-100 and traffic a whole number." };
  const { siteId, domainRating, organicTraffic } = parsed.data;
  await db.site.update({ where: { id: siteId }, data: { domainRating, organicTraffic, metricsProvider: "manual", metricsUpdatedAt: new Date() } });
  await db.auditLog.create({ data: { actorId: admin.id, action: "admin.site_metrics_set", target: siteId, meta: { domainRating, organicTraffic } } });
  // Re-run the rules: manual metrics below the minimums auto-reject.
  await assessSite(siteId);
  const after = await db.site.findUnique({ where: { id: siteId }, select: { domain: true, status: true } });
  return done(form, after?.status === "REJECTED" ? `Metrics saved. ${after.domain} is below the minimums and was rejected.` : `Metrics saved for ${after?.domain}.`);
}

export async function refreshSiteMetricsAction(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const siteId = String(form.get("siteId"));
  await assessSite(siteId, { forceMetrics: true });
  return done(form, "Metrics re-fetched and rules re-checked.");
}
