"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { lockWorkspaces } from "@/lib/ledger";
import { adjustReputation, REPUTATION } from "@/lib/reputation";
import { getSettings } from "@/lib/settings";
import { recomputeDealStatus, refundLeg } from "@/server/deals";
import { removeLeg } from "@/server/linkcheck";
import { notifyWorkspace } from "@/server/notify";
import { requireAdmin, requireMembership } from "@/server/session";
import type { FormState } from "./types";

export async function openDisputeAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireMembership("MEMBER");
  const dealId = String(form.get("dealId"));
  const reason = z.string().trim().min(10, "Explain the problem in a sentence or two").max(4000).safeParse(form.get("reason"));
  if (!reason.success) return { error: reason.error.issues[0].message };
  const deal = await db.deal.findFirst({ where: { id: dealId, participants: { some: { workspaceId: workspace.id } } }, include: { participants: true, legs: true } });
  if (!deal) return { error: "Deal not found." };
  if (["CANCELLED", "COMPLETED", "DISPUTED"].includes(deal.status)) return { error: "This deal can't be disputed now." };
  const legId = form.get("legId") ? String(form.get("legId")) : null;
  if (legId && !deal.legs.some((l) => l.id === legId)) return { error: "Pick a link from this deal." };
  const against = deal.participants.find((p) => p.workspaceId !== workspace.id)!.workspaceId;

  await db.$transaction([
    db.dispute.create({ data: { dealId, legId, openedByWorkspaceId: workspace.id, againstWorkspaceId: against, reason: reason.data, previousDealStatus: deal.status } }),
    db.deal.update({ where: { id: dealId }, data: { status: "DISPUTED" } }),
    db.auditLog.create({ data: { actorId: user.id, workspaceId: workspace.id, action: "dispute.opened", target: dealId } }),
  ]);
  await notifyWorkspace(against, { kind: "dispute.opened", title: `${workspace.name} opened a dispute`, body: `${reason.data.slice(0, 300)}\n\nAn admin will review it. Escrow releases and link checks are paused meanwhile.`, path: `/app/deals/${dealId}` }, { everyone: true });
  const admins = await db.user.findMany({ where: { platformRole: "ADMIN" } });
  await db.notification.createMany({ data: admins.map((a) => ({ userId: a.id, kind: "admin.dispute", title: "New dispute", body: reason.data.slice(0, 300), url: "/admin/disputes" })) });
  revalidatePath(`/app/deals/${dealId}`);
  return { ok: "Dispute opened. An admin will review it." };
}

const OUTCOMES = ["dismiss", "refund_leg", "refund_and_penalize"] as const;

export async function resolveDisputeAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ disputeId: z.string(), outcome: z.enum(OUTCOMES), legId: z.string().optional(), note: z.string().trim().min(5, "Write the resolution the parties will see").max(4000) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { disputeId, outcome, legId, note } = parsed.data;
  const dispute = await db.dispute.findUnique({ where: { id: disputeId }, include: { deal: { include: { legs: true } } } });
  if (!dispute || dispute.status !== "OPEN") return { error: "This dispute is already closed." };
  const leg = dispute.deal.legs.find((l) => l.id === (legId || dispute.legId));
  if (outcome !== "dismiss" && !leg) return { error: "Pick the link the outcome applies to." };
  if (outcome !== "dismiss" && leg && ["REMOVED", "CANCELLED"].includes(leg.status)) return { error: "That link is already closed." };
  const settings = await getSettings();

  const done = await db.$transaction(async (tx) => {
    await lockWorkspaces(tx, [dispute.openedByWorkspaceId, dispute.againstWorkspaceId]);
    // Claim the dispute first: a second submit finds it no longer OPEN and does nothing.
    const claimed = await tx.dispute.updateMany({ where: { id: dispute.id, status: "OPEN" }, data: { status: outcome === "dismiss" ? "REJECTED" : "RESOLVED", resolution: note, resolvedById: admin.id, resolvedAt: new Date() } });
    if (claimed.count !== 1) return false;
    if (outcome === "refund_leg" && leg) {
      // No-fault refund: closed as REMOVED but without removedAt, so it doesn't
      // count toward auto-suspension or "removed" stats.
      await tx.dealLeg.updateMany({ where: { id: leg.id, status: { notIn: ["REMOVED", "CANCELLED"] } }, data: { status: "REMOVED" } });
      await refundLeg(tx, leg, admin.id);
    }
    if (outcome === "refund_and_penalize" && leg)
      await removeLeg(tx, leg, settings.removalPenaltyCredits, { reputationDelta: REPUTATION.disputeLost, reason: "dispute lost", actorId: admin.id });
    // Back to where it was before the dispute, then let the legs decide.
    await tx.deal.update({ where: { id: dispute.dealId }, data: { status: dispute.previousDealStatus ?? "IN_PROGRESS" } });
    await recomputeDealStatus(tx, dispute.dealId);
    await tx.auditLog.create({ data: { actorId: admin.id, action: "admin.dispute_resolved", target: dispute.id, meta: { outcome, legId: leg?.id ?? null } } });
    return true;
  });
  if (!done) return { error: "This dispute was already resolved." };
  for (const ws of [dispute.openedByWorkspaceId, dispute.againstWorkspaceId])
    await notifyWorkspace(ws, { kind: "dispute.resolved", title: "Dispute resolved", body: note, path: `/app/deals/${dispute.dealId}` }, { everyone: true });
  revalidatePath("/admin/disputes");
  redirect(`/admin/disputes?${new URLSearchParams({ msg: "Dispute resolved." })}`);
}

export async function submitReviewAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireMembership("MEMBER");
  const parsed = z
    .object({ dealId: z.string(), rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Pick a rating from 1 to 5." };
  const { dealId, rating, comment } = parsed.data;
  const deal = await db.deal.findFirst({ where: { id: dealId, participants: { some: { workspaceId: workspace.id } } }, include: { participants: true } });
  if (!deal || !["LIVE", "COMPLETED"].includes(deal.status)) return { error: "You can review a partner once the deal is live." };
  const subject = deal.participants.find((p) => p.workspaceId !== workspace.id)!.workspaceId;
  try {
    await db.$transaction(async (tx) => {
      await tx.review.create({ data: { dealId, authorWorkspaceId: workspace.id, subjectWorkspaceId: subject, rating, comment: comment || null } });
      await adjustReputation(tx, subject, (rating - 3) * REPUTATION.reviewPerStarFromThree, `review: ${rating} stars`, user.id);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { error: "You've already reviewed this deal." };
    throw err;
  }
  revalidatePath(`/app/deals/${dealId}`);
  return { ok: "Thanks for the review." };
}
