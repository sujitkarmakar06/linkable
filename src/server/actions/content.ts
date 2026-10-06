"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { contentHash, validateGuestPost } from "@/lib/guestpost";
import { lockWorkspaces } from "@/lib/ledger";
import { getSettings } from "@/lib/settings";
import { AiError, draftGuestPost, suggestAnchors, suggestPlacement, type AnchorSuggestion, type PlacementSuggestion } from "@/server/ai";
import { recomputeDealStatus, refundLeg } from "@/server/deals";
import { notifyWorkspace } from "@/server/notify";
import { requireMembership } from "@/server/session";
import type { FormState } from "./types";

async function loadLeg(legId: string) {
  const ctx = await requireMembership("MEMBER");
  const leg = await db.dealLeg.findUnique({ where: { id: legId }, include: { fromSite: true, toSite: true, deal: true, guestPost: true } });
  if (!leg || (leg.giverWorkspaceId !== ctx.workspace.id && leg.receiverWorkspaceId !== ctx.workspace.id)) throw new Error("Link not found");
  return { ...ctx, leg };
}

const PUBLISH_DAYS = 7;
const dealPath = (id: string) => `/app/deals/${id}`;
const closedDeal = (status: string) => ["CANCELLED", "COMPLETED", "DISPUTED"].includes(status);

// ---------------------------------------------------------------------------
// Guest posts: the receiver writes, the host (giver) reviews and publishes.
// ---------------------------------------------------------------------------

export async function submitGuestPostAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace, leg } = await loadLeg(String(form.get("legId")));
  if (leg.receiverWorkspaceId !== workspace.id) return { error: "Only the side receiving the link writes the guest post." };
  if (leg.placementType !== "GUEST_POST") return { error: "This link isn't a guest post." };
  if (leg.status !== "PENDING" || closedDeal(leg.deal.status)) return { error: "This post can't be submitted right now." };
  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  if (body.length > 100_000) return { error: "That article is too long." };
  const settings = await getSettings();
  const errors = validateGuestPost({ title, body, targetUrl: leg.targetUrl, anchor: leg.anchor, receiverDomain: leg.toSite.domain, minWords: settings.guestPostMinWords });
  if (errors.length) return { error: errors.join(" ") };

  // AI drafts must be reviewed and edited by a person before submission.
  const drafts = await db.aiUsage.findMany({ where: { legId: leg.id, kind: "draft", workspaceId: workspace.id }, select: { outputHash: true } });
  if (drafts.some((d) => d.outputHash === contentHash(body))) return { error: "This is the unedited AI draft. Review it, check every [VERIFY] note, and edit it before submitting." };
  if (/\[VERIFY:/i.test(body)) return { error: "Replace every [VERIFY: ...] placeholder with a real, checked source (or remove the claim) before submitting." };

  const aiDrafted = drafts.length > 0;
  await db.$transaction(async (tx) => {
    await tx.guestPost.upsert({
      where: { legId: leg.id },
      create: { legId: leg.id, title, body, aiDrafted, status: "submitted" },
      update: { title, body, aiDrafted: aiDrafted || undefined, status: "submitted", hostNote: null, revision: { increment: 1 } },
    });
    await tx.dealLeg.update({ where: { id: leg.id }, data: { status: "CONTENT_SUBMITTED" } });
    await tx.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: "guestpost.submitted", target: leg.id, meta: { aiDrafted } } });
  });
  await notifyWorkspace(leg.giverWorkspaceId, { kind: "guestpost.submitted", title: `Guest post to review for ${leg.fromSite.domain}`, body: `"${title}"${aiDrafted ? " (AI-assisted)" : ""} is ready for your review.`, path: dealPath(leg.dealId) }, { everyone: true });
  revalidatePath(dealPath(leg.dealId));
  return { ok: "Submitted for review." };
}

export async function reviewGuestPostAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace, leg } = await loadLeg(String(form.get("legId")));
  if (leg.giverWorkspaceId !== workspace.id) return { error: "Only the host site reviews guest posts." };
  if (leg.status !== "CONTENT_SUBMITTED" || !leg.guestPost) return { error: "There's no post waiting for review." };
  const decision = z.enum(["approve", "changes", "reject"]).safeParse(form.get("decision"));
  if (!decision.success) return { error: "Choose a decision." };
  const note = String(form.get("note") ?? "").trim().slice(0, 4000);
  const settings = await getSettings();
  const gp = leg.guestPost;
  const changesLeft = gp.revision <= settings.guestPostMaxRevisions;

  if (decision.data === "changes") {
    if (!note) return { error: "Say what needs to change." };
    if (!changesLeft) return { error: `This post has had ${settings.guestPostMaxRevisions} revision rounds. Approve it or reject it.` };
  }
  if (decision.data === "reject") {
    if (!note) return { error: "Give a reason for rejecting." };
    if (changesLeft) return { error: `You can reject after ${settings.guestPostMaxRevisions} revision rounds. Request changes first, or open a dispute.` };
  }

  const raced = await db.$transaction(async (tx) => {
    await lockWorkspaces(tx, [leg.giverWorkspaceId, leg.receiverWorkspaceId]);
    // Re-check under the lock: a double submit or a concurrent cancel must not act twice.
    const fresh = await tx.dealLeg.findUniqueOrThrow({ where: { id: leg.id }, include: { deal: true } });
    if (fresh.status !== "CONTENT_SUBMITTED" || closedDeal(fresh.deal.status)) return true;
    if (decision.data === "approve") {
      await tx.guestPost.update({ where: { id: gp.id }, data: { status: "approved", hostNote: note || null } });
      // The host's publishing deadline starts now.
      await tx.dealLeg.update({ where: { id: leg.id }, data: { status: "CONTENT_APPROVED", dueAt: new Date(Date.now() + PUBLISH_DAYS * 86_400_000), overdueNotifiedAt: null } });
    } else if (decision.data === "changes") {
      await tx.guestPost.update({ where: { id: gp.id }, data: { status: "changes_requested", hostNote: note } });
      await tx.dealLeg.update({ where: { id: leg.id }, data: { status: "PENDING" } });
    } else {
      await tx.guestPost.update({ where: { id: gp.id }, data: { status: "rejected", hostNote: note } });
      await tx.dealLeg.update({ where: { id: leg.id }, data: { status: "CANCELLED" } });
      await refundLeg(tx, leg, user.id);
      await recomputeDealStatus(tx, leg.dealId);
    }
    await tx.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: `guestpost.${decision.data}`, target: leg.id } });
    return false;
  });
  if (raced) return { error: "This post was already reviewed or the deal changed. Reload the page." };
  const titles = { approve: "Guest post approved", changes: "Changes requested on your guest post", reject: "Guest post rejected" };
  const bodies = {
    approve: `${leg.fromSite.domain} approved "${gp.title}" and will publish it.`,
    changes: `${leg.fromSite.domain} asked for changes: ${note}`,
    reject: `${leg.fromSite.domain} rejected "${gp.title}": ${note}. Any escrowed credits for this link were refunded.`,
  };
  await notifyWorkspace(leg.receiverWorkspaceId, { kind: `guestpost.${decision.data}`, title: titles[decision.data], body: bodies[decision.data], path: dealPath(leg.dealId) }, { everyone: true });
  revalidatePath(dealPath(leg.dealId));
  return { ok: { approve: `Approved. Publish it within ${PUBLISH_DAYS} days, then add the page URL below.`, changes: "Changes requested.", reject: "Rejected; escrow refunded." }[decision.data] };
}

// ---------------------------------------------------------------------------
// AI helpers (results come back to the client; nothing is saved but usage).
// ---------------------------------------------------------------------------

export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function guard<T>(fn: () => Promise<T>): Promise<AiResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AiError) return { ok: false, error: err.message };
    console.error("[ai]", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function suggestAnchorsAction(siteId: string, targetUrl: string): Promise<AiResult<AnchorSuggestion[]>> {
  const { user, workspace } = await requireMembership("MEMBER");
  const site = await db.site.findFirst({ where: { id: siteId, workspaceId: workspace.id } });
  if (!site) return { ok: false, error: "Choose one of your sites first." };
  try {
    const host = new URL(targetUrl).hostname.replace(/^www\./, "");
    if (host !== site.domain && !host.endsWith(`.${site.domain}`)) return { ok: false, error: `Enter a target URL on ${site.domain} first.` };
  } catch {
    return { ok: false, error: "Enter the target page URL first." };
  }
  return guard(() => suggestAnchors({ workspaceId: workspace.id, userId: user.id, siteId, targetUrl }));
}

export async function suggestPlacementAction(legId: string): Promise<AiResult<PlacementSuggestion[]>> {
  const { user, workspace, leg } = await loadLeg(legId);
  if (leg.giverWorkspaceId !== workspace.id) return { ok: false, error: "Only the host site can do this." };
  return guard(() => suggestPlacement({ workspaceId: workspace.id, userId: user.id, legId }));
}

export async function draftGuestPostAction(legId: string, topic: string): Promise<AiResult<{ title: string; body: string }>> {
  const { user, workspace, leg } = await loadLeg(legId);
  if (leg.receiverWorkspaceId !== workspace.id || leg.placementType !== "GUEST_POST") return { ok: false, error: "Only the guest writer can draft this post." };
  if (leg.status !== "PENDING") return { ok: false, error: "This post is already submitted." };
  return guard(() => draftGuestPost({ workspaceId: workspace.id, userId: user.id, legId, topic: topic.trim().slice(0, 200) }));
}
