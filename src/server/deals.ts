import "server-only";
import type { DealLeg, DealStatus, Prisma, Proposal } from "@prisma/client";
import { releaseStages } from "@/lib/credits";
import { db } from "@/lib/db";
import { availableIn, lockWorkspaces, transferCredits } from "@/lib/ledger";
import { getSettings } from "@/lib/settings";
import { validateTerms, type Terms, type TermsSite } from "@/lib/terms";
import { checkTerms } from "@/server/footprint";
import { adjustReputation, REPUTATION } from "@/lib/reputation";

export const LEG_DUE_DAYS = 14;

export async function loadTermsSites(terms: Terms, client: Prisma.TransactionClient = db): Promise<Map<string, TermsSite>> {
  const ids = [...new Set(terms.legs.flatMap((l) => [l.fromSiteId, l.toSiteId]))];
  const rows = await client.site.findMany({ where: { id: { in: ids } } });
  return new Map(rows.map((s) => [s.id, s]));
}

export class DealError extends Error {}

type CreateDeal = {
  source: "PROPOSAL" | "REQUEST_OFFER" | "AUTO_MATCH";
  kind: "SWAP" | "REQUEST_OFFER";
  terms: Terms;
  parties: [string, string];
  linkRequestId: string | null;
  actingWorkspaceId: string;
  userId: string;
};

// Inside a transaction that already holds both workspace locks: re-validate
// the terms and footprint against current data, lock the payers' credits in
// escrow and create the deal.
export async function createDealFromTerms(tx: Prisma.TransactionClient, d: CreateDeal): Promise<string> {
  const sites = await loadTermsSites(d.terms, tx);
  const errors = validateTerms(d.kind, d.terms, sites, d.parties);
  if (errors.length) throw new DealError(errors[0]);
  const footprint = await checkTerms(d.terms, sites, tx);
  if (footprint.blocks.length) throw new DealError(footprint.blocks[0]);

  const owed = new Map<string, number>();
  for (const leg of d.terms.legs) {
    const payer = sites.get(leg.toSiteId)!.workspaceId;
    owed.set(payer, (owed.get(payer) ?? 0) + leg.credits);
  }
  for (const [workspaceId, amount] of owed) {
    if (amount > 0 && (await availableIn(tx, workspaceId)) < amount) {
      throw new DealError(workspaceId === d.actingWorkspaceId ? `You need ${amount} available credits for this.` : "The other side doesn't have enough credits for this deal right now.");
    }
  }

  const due = new Date(Date.now() + LEG_DUE_DAYS * 86_400_000);
  const deal = await tx.deal.create({
    data: {
      source: d.source,
      status: "AGREED",
      footprint: footprint.warnings.length ? { warnings: footprint.warnings } : undefined,
      participants: { create: d.parties.map((workspaceId) => ({ workspaceId, acceptedAt: new Date() })) },
      legs: {
        create: d.terms.legs.map((l) => ({
          fromSiteId: l.fromSiteId,
          toSiteId: l.toSiteId,
          giverWorkspaceId: sites.get(l.fromSiteId)!.workspaceId,
          receiverWorkspaceId: sites.get(l.toSiteId)!.workspaceId,
          linkRequestId: d.linkRequestId,
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
        createdById: d.userId,
      });
  }
  if (d.linkRequestId) {
    await tx.linkRequest.update({ where: { id: d.linkRequestId }, data: { status: "MATCHED" } });
    // Whichever way the request got fulfilled, other offers and matches close.
    await tx.proposal.updateMany({ where: { linkRequestId: d.linkRequestId, status: "OPEN" }, data: { status: "DECLINED" } });
    await tx.match.updateMany({ where: { linkRequestId: d.linkRequestId, status: "OFFERED" }, data: { status: "EXPIRED" } });
  }
  await tx.auditLog.create({ data: { actorId: d.userId, action: "deal.created", target: deal.id, meta: { source: d.source } } });
  return deal.id;
}

// Accept a proposal (swap or offer).
export async function acceptProposal(proposal: Proposal, userId: string): Promise<string> {
  return db.$transaction(async (tx) => {
    await lockWorkspaces(tx, [proposal.fromWorkspaceId, proposal.toWorkspaceId]);
    const fresh = await tx.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    if (fresh.status !== "OPEN" || fresh.revision !== proposal.revision) throw new DealError("This proposal changed or is no longer open. Reload and review it again.");
    if (fresh.linkRequestId) {
      const req = await tx.linkRequest.findUnique({ where: { id: fresh.linkRequestId } });
      if (req?.status !== "OPEN") throw new DealError("This request has already been fulfilled or cancelled.");
    }
    const dealId = await createDealFromTerms(tx, {
      source: proposal.kind === "SWAP" ? "PROPOSAL" : "REQUEST_OFFER",
      kind: proposal.kind,
      terms: proposal.terms as Terms,
      parties: [proposal.fromWorkspaceId, proposal.toWorkspaceId],
      linkRequestId: proposal.linkRequestId,
      actingWorkspaceId: proposal.awaitingWorkspaceId,
      userId,
    });
    await tx.proposal.update({ where: { id: proposal.id }, data: { status: "ACCEPTED", dealId } });
    // Messages from the negotiation carry over to the deal thread.
    await tx.message.updateMany({ where: { proposalId: proposal.id }, data: { dealId } });
    return dealId;
  });
}

// Release the first escrow stage now and schedule the rest (processed by the
// Phase 4 job). Receiver's escrow -> giver's available balance.
export async function releaseOnVerify(tx: Prisma.TransactionClient, leg: DealLeg, userId: string | null) {
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
        createdById: userId ?? undefined,
      });
    await tx.escrowRelease.create({ data: { dealId: leg.dealId, legId: leg.id, amount: s.amount, releaseAt: s.releaseAt, releasedAt: now ? new Date() : null } });
  }
}

export async function refundLeg(tx: Prisma.TransactionClient, leg: DealLeg, userId: string | null) {
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
      createdById: userId ?? undefined,
    });
}

export async function recomputeDealStatus(tx: Prisma.TransactionClient, dealId: string) {
  const deal = await tx.deal.findUniqueOrThrow({ where: { id: dealId }, include: { legs: true } });
  if (deal.status === "CANCELLED" || deal.status === "DISPUTED" || deal.status === "COMPLETED") return deal.status;
  const active = deal.legs.filter((l) => l.status !== "CANCELLED" && l.status !== "REMOVED");
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

// First verification of a placed link (by the crawler or the receiver):
// release the first escrow stage, reward on-time placement, fulfil the request.
export async function markVerified(tx: Prisma.TransactionClient, leg: DealLeg, userId: string | null) {
  await tx.dealLeg.update({ where: { id: leg.id }, data: { status: "VERIFIED", verifiedAt: new Date(), consecutiveFailures: 0, failingSince: null } });
  await releaseOnVerify(tx, leg, userId);
  if (leg.linkRequestId) await tx.linkRequest.update({ where: { id: leg.linkRequestId }, data: { status: "FULFILLED" } });
  if (leg.placedAt && leg.dueAt && leg.placedAt <= leg.dueAt) await adjustReputation(tx, leg.giverWorkspaceId, REPUTATION.verifiedOnTime, "link placed on time", userId);
  await recomputeDealStatus(tx, leg.dealId);
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
    await markVerified(tx, fresh, userId);
  });
}

// Either side can cancel until any link has been placed; escrow is refunded.
export async function cancelDeal(dealId: string, userId: string) {
  await db.$transaction(async (tx) => {
    const deal = await tx.deal.findUniqueOrThrow({ where: { id: dealId }, include: { legs: true, participants: true } });
    await lockWorkspaces(tx, deal.participants.map((p) => p.workspaceId));
    const legs = await tx.dealLeg.findMany({ where: { dealId } });
    if (legs.some((l) => ["PLACED", "VERIFIED", "FAILING"].includes(l.status))) throw new DealError("A link has already been placed. Open a dispute instead.");
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
