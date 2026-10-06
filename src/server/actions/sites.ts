"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { normalizeDomain } from "@/lib/domain";
import { isBannedNiche, isNiche } from "@/lib/niches";
import { getSettings } from "@/lib/settings";
import { disconnect } from "@/server/gsc";
import { markVerified, recordVerifyFailure, runVerification } from "@/server/sites";
import { requireMembership } from "@/server/session";
import type { FormState } from "./types";

const siteFields = z
  .object({
    niche: z.string().refine(isNiche, "Pick a niche from the list"),
    country: z.string().trim().max(56).optional().transform((v) => v || null),
    maxOutboundPerMonth: z.coerce.number().int().min(1, "At least 1").max(20, "At most 20 a month"),
    canGive: z.string().optional().transform((v) => v === "on"),
    canReceive: z.string().optional().transform((v) => v === "on"),
    brandTerms: z
      .string()
      .optional()
      .transform((v) => [...new Set((v ?? "").split(",").map((b) => b.trim()).filter(Boolean))])
      .refine((v) => v.length <= 5 && v.every((b) => b.length <= 40), "Up to 5 brand names, 40 characters each"),
  })
  .refine((v) => v.canGive || v.canReceive, { message: "A site must give links, receive links, or both." });

export async function createSiteAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireMembership("ADMIN");
  const domain = normalizeDomain(String(form.get("domain") ?? ""));
  if (!domain) return { error: "Enter a valid domain, like example.com." };
  const parsed = siteFields.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const settings = await getSettings();
  if (isBannedNiche(parsed.data.niche, settings.bannedNiches)) return { error: `The "${parsed.data.niche}" niche isn't allowed on Linkable.` };
  if (workspace.plan === "FREE") {
    const count = await db.site.count({ where: { workspaceId: workspace.id, status: { not: "REJECTED" } } });
    if (count >= settings.freeMaxSites)
      return { error: `The free plan allows ${settings.freeMaxSites} site${settings.freeMaxSites === 1 ? "" : "s"} per workspace. Remove a rejected or unused site first.` };
  }
  if (await db.site.findUnique({ where: { workspaceId_domain: { workspaceId: workspace.id, domain } } })) return { error: `${domain} is already in this workspace.` };
  if (await db.site.findUnique({ where: { verifiedDomain: domain } })) return { error: `${domain} is already verified by another workspace. If you own it, contact support.` };

  const site = await db.site.create({ data: { ...parsed.data, domain, workspaceId: workspace.id, verificationToken: randomToken(24) } });
  await db.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: "site.created", target: site.id, meta: { domain } } });
  redirect(`/app/sites/${site.id}`);
}

async function ownSite(id: string) {
  const ctx = await requireMembership("ADMIN");
  const site = await db.site.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
  if (!site) throw new Error("Site not found");
  return { ...ctx, site };
}

export async function updateSiteAction(_: FormState, form: FormData): Promise<FormState> {
  const { site } = await ownSite(String(form.get("siteId")));
  const parsed = siteFields.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const settings = await getSettings();
  if (isBannedNiche(parsed.data.niche, settings.bannedNiches)) return { error: `The "${parsed.data.niche}" niche isn't allowed on Linkable.` };
  // Changing the niche of an approved site sends it back for review.
  const nicheChanged = site.status === "APPROVED" && parsed.data.niche !== site.niche;
  await db.site.update({ where: { id: site.id }, data: { ...parsed.data, ...(nicheChanged ? { status: "PENDING_REVIEW" } : {}) } });
  revalidatePath(`/app/sites/${site.id}`);
  return { ok: nicheChanged ? "Saved. The niche change sends the site back to admin review." : "Saved." };
}

export async function verifySiteAction(_: FormState, form: FormData): Promise<FormState> {
  const { site } = await ownSite(String(form.get("siteId")));
  if (site.verifiedAt) return { ok: "Already verified." };
  const method = z.enum(["DNS_TXT", "META_TAG", "HTML_FILE"]).safeParse(form.get("method"));
  if (!method.success) return { error: "Pick a verification method." };
  const outcome = await runVerification(site, method.data);
  if (!outcome.ok) {
    await recordVerifyFailure(site.id, outcome.reason);
    return { error: outcome.reason };
  }
  const marked = await markVerified(site, method.data);
  if (!marked.ok) return { error: marked.reason };
  revalidatePath(`/app/sites/${site.id}`);
  revalidatePath("/app/sites");
  return { ok: "Ownership verified." };
}

export async function deleteSiteAction(form: FormData) {
  const { user, workspace, site } = await ownSite(String(form.get("siteId")));
  const used = await db.dealLeg.count({ where: { OR: [{ fromSiteId: site.id }, { toSiteId: site.id }] } });
  if (used > 0) throw new Error("This site is part of a deal and can't be deleted.");
  await db.site.delete({ where: { id: site.id } });
  await db.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: "site.deleted", meta: { domain: site.domain } } });
  revalidatePath("/app/sites");
  redirect("/app/sites");
}

export async function disconnectGscAction(form: FormData) {
  const { user, workspace, site } = await ownSite(String(form.get("siteId")));
  await disconnect(site.id);
  await db.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: "site.gsc_disconnected", target: site.id } });
  revalidatePath(`/app/sites/${site.id}`);
  redirect(`/app/sites/${site.id}?gsc=disconnected`);
}
