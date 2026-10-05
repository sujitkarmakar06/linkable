import "server-only";
import type { DealLeg, DealStatus, Prisma, Proposal } from "@prisma/client";
import { releaseStages } from "@/lib/credits";
import { db } from "@/lib/db";
import { availableIn, lockWorkspaces, transferCredits } from "@/lib/ledger";
import { getSettings } from "@/lib/settings";
import { validateTerms, type Terms, type TermsSite } from "@/lib/terms";

export const LEG_DUE_DAYS = 14;

export async function loadTermsSites(terms: Terms, client: Prisma.TransactionClient = db): Promise<Map<string, TermsSite>> {
  const ids = [...new Set(terms.legs.flatMap((l) => [l.fromSiteId, l.toSiteId]))];
  const rows = await client.site.findMany({ where: { id: { in: ids } } });
  return new Map(rows.map((s) => [s.id, s]));
}

export class DealError extends Error {}

// Accept a proposal: re-validate against current site data, lock the payers'
// credits in escrow and create the deal, all in one transaction.
export async function acceptProposal(proposal: Proposal, userId: string): Promise<string> {
  const terms = proposal.terms as Terms;
  return db.$transaction(async (tx) => {
    await lockWorkspaces(tx, [proposal.fromWorkspaceId, proposal.toWorkspaceId]);
    const fresh = await tx.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    if (fresh.status !== "OPEN" || fresh.revision !== proposal.revision) throw new DealError("This proposal changed or is no longer open. Reload and review it again.");

    const sites = await loadTermsSites(terms, tx);
    const errors = validateTerms(proposal.kind, terms, sites, [proposal.fromWorkspaceId, proposal.toWorkspaceId]);
    if (errors.length) throw new DealError(errors[0]);

    const owed = new Map<string, number>();
    for (const leg of terms.legs) {
      const payer = sites.get(leg.toSiteId)!.workspaceId;
      owed.set(payer, (owed.get(payer) ?? 0) + leg.credits);
    }
    for (const [workspaceId, amount] of owed) {
      if (amount > 0 && (await availableIn(tx, workspaceId)) < amount) {
        throw new DealError(workspaceId === proposal.awaitingWorkspaceId ? `You need ${amount} available credits to accept this.` : "The other side no longer has enough credits for this deal.");
      }
    }

    const due = new Date(Date.now() + LEG_DUE_DAYS * 86_400_000);
    const deal = await tx.deal.create({
      data: {
        source: proposal.kind === "SWAP" ? "PROPOSAL" : "REQUEST_OFFER",
        status: "AGREED",
        participants: {
          create: [proposal.fromWorkspaceId, proposal.toWorkspaceId].map((workspaceId) => ({ workspaceId, acceptedAt: new Date() })),
        },
        legs: {
          create: terms.legs.map((l) => ({
            fromSiteId: l.fromSiteId,
            toSiteId: l.toSiteId,
            giverWorkspaceId: sites.get(l.fromSiteId)!.workspaceId,
            receiverWorkspaceId: sites.get(l.toSiteId)!.workspaceId,
            linkRequestId: proposal.linkRequestId,
            targetUrl: l.targetUrl,
            anchor: l.anchor,
            rel: l.rel,
            placementType: l.placementType,
            credits: l.credits,
            dueAt: due,
          })),
        },
      },
    });
    for (const [workspaceId, amount] of owed) {
      if (amount > 0)
        await transferCredits(tx, {
          from: { workspaceId, bucket: "AVAILABLE" },
          to: { workspaceId, bucket: "ESCROW" },
          amount,
          reason: "ESCROW_LOCK",
          dealId: deal.id,
          createdById: userId,
        });
    }
    await tx.proposal.update({ where: { id: proposal.id }, data: { status: "ACCEPTED", dealId: deal.id } });
    if (proposal.linkRequestId) await tx.linkRequest.update({ where: { id: proposal.linkRequestId }, data: { status: "MATCHED" } });
    // Messages from the negotiation carry over to the deal thread.
    await tx.message.updateMany({ where: { proposalId: proposal.id }, data: { dealId: deal.id } });
    await tx.auditLog.create({ data: { actorId: userId, action: "deal.created", target: deal.id, meta: { proposalId: proposal.id } } });
    return deal.id;
  });
}

// Release the first escrow stage now and schedule the rest (processed by the
// Phase 4 job). Receiver's escrow -> giver's available balance.
async function releaseOnVerify(tx: Prisma.TransactionClient, leg: DealLeg, userId: string) {
  if (leg.credits <= 0) return;
  const stages = releaseStages(leg.credits, new Date());
  for (const s of stages) {
    const now = s.afterMonths === 0;
    if (now)
      await transferCredits(tx, {
        from: { workspaceId: leg.receiverWorkspaceId, bucket: "ESCROW" },
        to: { workspaceId: leg.giverWorkspaceId, bucket: "AVAILABLE" },
        amount: s.amount,
        reason: "ESCROW_RELEASE",
        dealId: leg.dealId,
        note: "Link verified - first release",
        createdById: userId,
      });
    await tx.escrowRelease.create({ data: { dealId: leg.dealId, legId: leg.id, amount: s.amount, releaseAt: s.releaseAt, releasedAt: now ? new Date() : null } });
  }
}

async function refundLeg(tx: Prisma.TransactionClient, leg: DealLeg, userId: string) {
  const released = await tx.escrowRelease.aggregate({ where: { legId: leg.id, releasedAt: { not: null } }, _sum: { amount: true } });
  const remaining = leg.credits - (released._sum.amount ?? 0);
  await tx.escrowRelease.updateMany({ where: { legId: leg.id, releasedAt: null, cancelledAt: null }, data: { cancelledAt: new Date() } });
  if (remaining > 0)
    await transferCredits(tx, {
      from: { workspaceId: leg.receiverWorkspaceId, bucket: "ESCROW" },
      to: { workspaceId: leg.receiverWorkspaceId, bucket: "AVAILABLE" },
      amount: remaining,
      reason: "ESCROW_REFUND",
      dealId: leg.dealId,
      createdById: userId,
    });
}

export async function recomputeDealStatus(tx: Prisma.TransactionClient, dealId: string) {
  const deal = await tx.deal.findUniqueOrThrow({ where: { id: dealId }, include: { legs: true } });
  if (deal.status === "CANCELLED" || deal.status === "DISPUTED" || deal.status === "COMPLETED") return deal.status;
  const active = deal.legs.filter((l) => l.status !== "CANCELLED");
  let status: DealStatus = deal.status;
  if (active.length === 0) status = "CANCELLED";
  else if (active.every((l) => l.status === "VERIFIED")) status = "LIVE";
  else if (active.some((l) => ["PLACED", "VERIFIED"].includes(l.status))) status = "IN_PROGRESS";
  if (status !== deal.status) {
    const settings = await getSettings();
    let guaranteeEnds = deal.guaranteeEnds;
    if (status === "LIVE") {
      guaranteeEnds = new Date();
      guaranteeEnds.setUTCMonth(guaranteeEnds.getUTCMonth() + settings.guaranteeMonths);
    }
    await tx.deal.update({ where: { id: dealId }, data: { status, guaranteeEnds } });
  }
  return status;
}

export async function placeLeg(leg: DealLeg, sourcePageUrl: string) {
  await db.$transaction(async (tx) => {
    await tx.dealLeg.update({ where: { id: leg.id }, data: { status: "PLACED", sourcePageUrl, placedAt: new Date() } });
    await recomputeDealStatus(tx, leg.dealId);
  });
}

export async function confirmLeg(leg: DealLeg, userId: string) {
  await db.$transaction(async (tx) => {
    await lockWorkspaces(tx, [leg.giverWorkspaceId, leg.receiverWorkspaceId]);
    const fresh = await tx.dealLeg.findUniqueOrThrow({ where: { id: leg.id } });
    if (fresh.status !== "PLACED") throw new DealError("This link isn't waiting for confirmation.");
    await tx.dealLeg.update({ where: { id: leg.id }, data: { status: "VERIFIED", verifiedAt: new Date() } });
    await releaseOnVerify(tx, fresh, userId);
    if (fresh.linkRequestId) await tx.linkRequest.update({ where: { id: fresh.linkRequestId }, data: { status: "FULFILLED" } });
    await recomputeDealStatus(tx, leg.dealId);
  });
}

// Either side can cancel until any link has been placed; escrow is refunded.
export async function cancelDeal(dealId: string, userId: string) {
  await db.$transaction(async (tx) => {
    const deal = await tx.deal.findUniqueOrThrow({ where: { id: dealId }, include: { legs: true, participants: true } });
    await lockWorkspaces(tx, deal.participants.map((p) => p.workspaceId));
    const legs = await tx.dealLeg.findMany({ where: { dealId } });
    if (legs.some((l) => ["PLACED", "VERIFIED"].includes(l.status))) throw new DealError("A link has already been placed. Open a dispute instead (coming in Phase 4).");
    if (deal.status === "CANCELLED") return;
    for (const leg of legs) {
      await refundLeg(tx, leg, userId);
      if (leg.linkRequestId) await tx.linkRequest.updateMany({ where: { id: leg.linkRequestId, status: "MATCHED" }, data: { status: "OPEN" } });
    }
    await tx.dealLeg.updateMany({ where: { dealId }, data: { status: "CANCELLED" } });
    await tx.deal.update({ where: { id: dealId }, data: { status: "CANCELLED" } });
    await tx.auditLog.create({ data: { actorId: userId, action: "deal.cancelled", target: dealId } });
  });
}
