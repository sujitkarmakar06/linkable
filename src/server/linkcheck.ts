import "server-only";
import type { DealLeg, Site } from "@prisma/client";
import { db } from "@/lib/db";
import { transferCredits, lockWorkspaces } from "@/lib/ledger";
import { analysePage, judge, nextLegState, type CheckVerdict } from "@/lib/linkcheck";
import { safeGet } from "@/lib/net";
import { adjustReputation, REPUTATION } from "@/lib/reputation";
import { getSettings, PLATFORM_ADMIN_EMAILS } from "@/lib/settings";
import { markVerified, recomputeDealStatus, refundLeg } from "@/server/deals";
import { notifyWorkspace } from "@/server/notify";

type LegWithSites = DealLeg & { fromSite: Site; toSite: Site };

export const REPEAT_REMOVALS_FOR_SUSPENSION = 3;

// Fetch the source page, record a LinkCheck, and move the leg through its states.
export async function checkLeg(legId: string): Promise<CheckVerdict | null> {
  const leg = await db.dealLeg.findUnique({ where: { id: legId }, include: { fromSite: true, toSite: true, deal: true } });
  if (!leg || !leg.sourcePageUrl || !["PLACED", "VERIFIED", "FAILING"].includes(leg.status) || ["DISPUTED", "CANCELLED", "COMPLETED"].includes(leg.deal.status)) return null;
  const settings = await getSettings();

  let status: number | null = null;
  let finalUrl: string | null = null;
  let redirects = 0;
  let error: string | null = null;
  let analysis = null;
  try {
    const res = await safeGet(leg.sourcePageUrl);
    status = res.status;
    finalUrl = res.url;
    redirects = res.redirects;
    if (res.ok) analysis = analysePage(res.body, { pageUrl: res.url, targetUrl: leg.targetUrl, anchor: leg.anchor, xRobotsTag: res.xRobotsTag });
  } catch (err) {
    error = (err as Error).message.slice(0, 300);
  }
  const verdict = judge(status, analysis, leg.rel, error);

  await db.linkCheck.create({
    data: {
      legId: leg.id,
      httpStatus: status,
      finalUrl,
      redirects,
      linkFound: analysis?.linkFound ?? false,
      anchorMatch: analysis?.anchorMatch ?? null,
      rel: analysis?.rel ?? null,
      noindex: analysis?.noindex ?? null,
      canonicalUrl: analysis?.canonicalUrl ?? null,
      error: verdict.ok ? null : verdict.problems.join(" "),
    },
  });

  const now = new Date();
  const next = nextLegState(
    { status: leg.status as "PLACED" | "VERIFIED" | "FAILING", consecutiveFailures: leg.consecutiveFailures, failingSince: leg.failingSince },
    verdict.ok,
    now,
    settings,
  );

  await db.$transaction(async (tx) => {
    await lockWorkspaces(tx, [leg.giverWorkspaceId, leg.receiverWorkspaceId]);
    const fresh = await tx.dealLeg.findUniqueOrThrow({ where: { id: leg.id }, include: { deal: true } });
    // Changed meanwhile (manual confirm, cancel, dispute): leave it alone.
    if (fresh.status !== leg.status || ["DISPUTED", "CANCELLED", "COMPLETED"].includes(fresh.deal.status)) return;
    await tx.dealLeg.update({ where: { id: leg.id }, data: { lastCheckedAt: now, consecutiveFailures: next.consecutiveFailures, failingSince: next.failingSince } });
    if (next.event === "verified") await markVerified(tx, fresh, null);
    else if (next.event === "failing" || next.event === "restored") {
      await tx.dealLeg.update({ where: { id: leg.id }, data: { status: next.status } });
      await recomputeDealStatus(tx, leg.dealId);
    } else if (next.event === "removed") await removeLeg(tx, fresh, settings.removalPenaltyCredits);
  });

  await notifyEvent(leg, next.event, verdict, settings.graceDays, settings.removalPenaltyCredits);
  return verdict;
}

// Grace period over: refund what's still in escrow, compensate the receiver
// with the penalty, and hit the giver's reputation. Balances may go negative;
// a workspace in debt can't spend until it earns credits back.
export async function removeLeg(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  leg: DealLeg,
  penalty: number,
  { reputationDelta = REPUTATION.linkRemoved as number, reason = "link removed during guarantee", actorId = null as string | null } = {},
) {
  await tx.dealLeg.update({ where: { id: leg.id }, data: { status: "REMOVED", removedAt: new Date() } });
  await refundLeg(tx, leg, null);
  if (penalty > 0)
    await transferCredits(tx, {
      from: { workspaceId: leg.giverWorkspaceId, bucket: "AVAILABLE" },
      to: { workspaceId: leg.receiverWorkspaceId, bucket: "AVAILABLE" },
      amount: penalty,
      reason: "PENALTY",
      dealId: leg.dealId,
      legId: leg.id,
      note: reason,
      createdById: actorId ?? undefined,
    });
  await adjustReputation(tx, leg.giverWorkspaceId, reputationDelta, reason, actorId);
  await recomputeDealStatus(tx, leg.dealId);

  const yearAgo = new Date(Date.now() - 365 * 86_400_000);
  const removals = await tx.dealLeg.count({ where: { giverWorkspaceId: leg.giverWorkspaceId, status: "REMOVED", removedAt: { gte: yearAgo } } });
  if (removals >= REPEAT_REMOVALS_FOR_SUSPENSION) {
    await tx.workspace.update({ where: { id: leg.giverWorkspaceId }, data: { suspendedAt: new Date() } });
    await tx.auditLog.create({ data: { workspaceId: leg.giverWorkspaceId, action: "workspace.auto_suspended", meta: { removals } } });
    const admins = await tx.user.findMany({ where: { OR: [{ platformRole: "ADMIN" }, { email: { in: PLATFORM_ADMIN_EMAILS } }] } });
    for (const a of admins)
      await tx.notification.create({ data: { userId: a.id, kind: "admin.auto_suspended", title: "A workspace was suspended automatically", body: `${removals} removed links in 12 months.`, url: "/admin" } });
  }
}

async function notifyEvent(leg: LegWithSites, event: string | null, verdict: CheckVerdict, graceDays: number, penalty: number) {
  if (!event) return;
  const path = `/app/deals/${leg.dealId}`;
  const page = leg.sourcePageUrl;
  const why = verdict.problems.join(" ");
  const both = async (title: string, body: string) => {
    for (const ws of [leg.giverWorkspaceId, leg.receiverWorkspaceId]) await notifyWorkspace(ws, { kind: `leg.${event}`, title, body, path }, { everyone: true });
  };
  if (event === "verified") await both(`Link verified: ${leg.fromSite.domain} → ${leg.toSite.domain}`, `Our crawler found the link on ${page}. The guarantee has started.`);
  if (event === "not_found") await notifyWorkspace(leg.giverWorkspaceId, { kind: "leg.not_found", title: `We can't find your link on ${leg.fromSite.domain}`, body: `${why} Check ${page}.`, path }, { everyone: true });
  if (event === "failing") await both(`Link check failing: ${leg.fromSite.domain} → ${leg.toSite.domain}`, `${why} ${leg.fromSite.domain} has ${graceDays} days to restore it before it counts as removed.`);
  if (event === "restored") await both(`Link restored: ${leg.fromSite.domain} → ${leg.toSite.domain}`, "The link is back and passing checks.");
  if (event === "removed")
    await both(`Link removed: ${leg.fromSite.domain} → ${leg.toSite.domain}`, `The link wasn't restored within ${graceDays} days. Unreleased credits were refunded and a ${penalty}-credit penalty was applied.`);
}

// Which legs are due: placed links on every run, failing links daily, verified links every N days.
export async function dueLegIds(limit: number): Promise<string[]> {
  const settings = await getSettings();
  const cutoff = new Date(Date.now() - settings.checkIntervalDays * 86_400_000 + 3_600_000); // 1h slack so a daily cron doesn't drift
  const dayAgo = new Date(Date.now() - 20 * 3_600_000);
  const legs = await db.dealLeg.findMany({
    where: {
      sourcePageUrl: { not: null },
      deal: { status: { notIn: ["DISPUTED", "CANCELLED", "COMPLETED"] } },
      OR: [
        { status: "PLACED" },
        { status: "FAILING", OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: dayAgo } }] },
        { status: "VERIFIED", OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: cutoff } }] },
      ],
    },
    select: { id: true },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: limit,
  });
  return legs.map((l) => l.id);
}
