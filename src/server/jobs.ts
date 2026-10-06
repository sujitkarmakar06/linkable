import "server-only";
import { db } from "@/lib/db";
import { lockWorkspaces, transferCredits } from "@/lib/ledger";
import { escrowHeld } from "@/server/deals";
import { adjustReputation, REPUTATION } from "@/lib/reputation";
import { checkLeg, dueLegIds } from "@/server/linkcheck";
import { notifyWorkspace, sendDigests } from "@/server/notify";
import { runMonthlyReports } from "@/server/reports";
import { PAYABLE_INDEX_STATES } from "@/lib/indexing";
import { expireUnindexed, remindUnindexed, runIndexChecks } from "@/server/indexing";
import { runImpactFetch } from "@/server/impact";

// Overdue placements: tell both sides once, and dock the giver's reputation.
export async function flagOverdue() {
  const legs = await db.dealLeg.findMany({
    where: {
      dueAt: { lt: new Date() },
      overdueNotifiedAt: null,
      deal: { status: { in: ["AGREED", "IN_PROGRESS"] } },
      // The giver is late on an insertion, or on publishing an approved guest post.
      // (A guest post still waiting for content is the writer's delay, not the host's.)
      OR: [{ placementType: "INSERTION", status: "PENDING" }, { placementType: "GUEST_POST", status: "CONTENT_APPROVED" }],
    },
    include: { fromSite: true, toSite: true },
    take: 500,
  });
  for (const leg of legs) {
    // Conditional so overlapping runs (cron + admin button) flag it once.
    const flagged = await db.$transaction(async (tx) => {
      const { count } = await tx.dealLeg.updateMany({ where: { id: leg.id, overdueNotifiedAt: null }, data: { overdueNotifiedAt: new Date() } });
      if (count === 1) await adjustReputation(tx, leg.giverWorkspaceId, REPUTATION.placementOverdue, "link placement overdue");
      return count === 1;
    });
    if (!flagged) continue;
    for (const ws of [leg.giverWorkspaceId, leg.receiverWorkspaceId])
      await notifyWorkspace(
        ws,
        { kind: "leg.overdue", title: `Overdue: link from ${leg.fromSite.domain} to ${leg.toSite.domain}`, body: "The agreed placement date has passed. Place the link, or cancel or dispute the deal.", path: `/app/deals/${leg.dealId}` },
        { everyone: true },
      );
  }
  return legs.length;
}

export async function runLinkChecks(limit = 60, concurrency = 6) {
  const ids = await dueLegIds(limit);
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = await Promise.allSettled(ids.slice(i, i + concurrency).map((id) => checkLeg(id)));
    for (const r of batch) {
      if (r.status === "fulfilled" && r.value?.ok) ok++;
      else failed++;
      if (r.status === "rejected") console.error("[linkcheck]", r.reason);
    }
  }
  return { checked: ids.length, ok, failed };
}

// Scheduled escrow stages. Held until Google has indexed the linking page, and
// while the link is failing or the deal is disputed.
export async function releaseDueEscrow(legIds?: string[]) {
  const due = await db.escrowRelease.findMany({
    where: { releaseAt: { lte: new Date() }, releasedAt: null, cancelledAt: null, ...(legIds ? { legId: { in: legIds } } : {}) },
    orderBy: { releaseAt: "asc" },
    take: 500,
  });
  let released = 0;
  for (const r of due) {
    const leg = await db.dealLeg.findUnique({ where: { id: r.legId }, include: { deal: true } });
    if (!leg || leg.status !== "VERIFIED" || leg.consecutiveFailures > 0 || leg.deal.status === "DISPUTED" || !PAYABLE_INDEX_STATES.includes(leg.indexState)) continue;
    await db.$transaction(async (tx) => {
      await lockWorkspaces(tx, [leg.giverWorkspaceId, leg.receiverWorkspaceId]);
      const fresh = await tx.dealLeg.findUniqueOrThrow({ where: { id: leg.id }, include: { deal: true } });
      // Hold payouts while the latest check failed, even before the leg is FAILING.
      if (fresh.status !== "VERIFIED" || fresh.consecutiveFailures > 0 || fresh.deal.status === "DISPUTED" || !PAYABLE_INDEX_STATES.includes(fresh.indexState)) return;
      if ((await escrowHeld(tx, fresh)) < r.amount) return; // nothing left to pay out
      const { count } = await tx.escrowRelease.updateMany({ where: { id: r.id, releasedAt: null, cancelledAt: null }, data: { releasedAt: new Date() } });
      if (!count) return;
      await transferCredits(tx, {
        from: { workspaceId: leg.receiverWorkspaceId, bucket: "ESCROW" },
        to: { workspaceId: leg.giverWorkspaceId, bucket: "AVAILABLE" },
        amount: r.amount,
        reason: "ESCROW_RELEASE",
        dealId: leg.dealId,
        legId: leg.id,
        note: r.releaseAt.getTime() === fresh.verifiedAt?.getTime() ? "Link verified and indexed - first release" : "Scheduled release",
      });
      released++;
    });
  }
  return released;
}

// Guarantee served and every link still live: the deal is completed.
export async function completeDeals() {
  const deals = await db.deal.findMany({ where: { status: "LIVE", guaranteeEnds: { lte: new Date() } }, include: { legs: true }, take: 500 });
  let completed = 0;
  for (const d of deals) {
    const active = d.legs.filter((l) => !["CANCELLED", "REMOVED"].includes(l.status));
    if (!active.every((l) => l.status === "VERIFIED")) continue;
    const pending = await db.escrowRelease.count({ where: { dealId: d.id, releasedAt: null, cancelledAt: null } });
    if (pending) continue;
    const done = await db.$transaction(async (tx) => {
      // Only a deal that is still LIVE (not disputed meanwhile, not completed by another run).
      const { count } = await tx.deal.updateMany({ where: { id: d.id, status: "LIVE" }, data: { status: "COMPLETED" } });
      if (count !== 1) return false;
      for (const ws of new Set(active.map((l) => l.giverWorkspaceId))) await adjustReputation(tx, ws, REPUTATION.dealCompleted, "deal completed");
      return true;
    });
    if (done) completed++;
  }
  return completed;
}

export async function runDaily() {
  const overdue = await flagOverdue();
  const checks = await runLinkChecks();
  const indexing = await runIndexChecks();
  const notIndexed = await expireUnindexed();
  const indexReminders = await remindUnindexed();
  const released = await releaseDueEscrow();
  const completed = await completeDeals();
  const impact = await runImpactFetch();
  const digests = await sendDigests();
  const reports = await runMonthlyReports();
  // Rate-limit records only matter for minutes; keep a day for investigation.
  const pruned = (await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 86_400_000) } } })).count;
  return { overdue, checks, indexing: { checked: indexing.checked, indexed: indexing.indexed.length }, notIndexed, indexReminders, released, completed, impact, digests, reports, pruned };
}
