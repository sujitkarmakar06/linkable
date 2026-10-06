import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { classifyAnchor } from "@/lib/anchors";
import { evaluateFootprint, mergeResults, type FootprintResult, type FootprintSite } from "@/lib/footprint";
import { getSettings } from "@/lib/settings";
import type { Terms } from "@/lib/terms";

const ACTIVE = { notIn: ["CANCELLED", "REMOVED"] as ("CANCELLED" | "REMOVED")[] };

function monthsAgo(n: number) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
}

// Loads history and evaluates one prospective link from giver -> receiver.
// `extraFromGiver` counts other links in the same proposal toward the monthly cap.
export async function checkLink(
  giver: FootprintSite,
  receiver: FootprintSite,
  anchor: string,
  { client = db, extraFromGiver = 0 }: { client?: Prisma.TransactionClient; extraFromGiver?: number } = {},
): Promise<FootprintResult> {
  const settings = await getSettings();
  const since = monthsAgo(settings.pairCooldownMonths);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

  const sixMonthsBack = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 5, 1));
  const [reverseLinksRecent, sameLinkActive, pairDeals, giverLinksThisMonth, anchorUsesForTarget, toTarget, recentToTarget] = await Promise.all([
    client.dealLeg.count({ where: { fromSiteId: receiver.id, toSiteId: giver.id, status: ACTIVE, createdAt: { gte: since } } }),
    client.dealLeg.count({ where: { fromSiteId: giver.id, toSiteId: receiver.id, status: ACTIVE } }),
    client.deal.findMany({
      where: { status: { not: "CANCELLED" }, createdAt: { gte: since }, AND: [{ participants: { some: { workspaceId: giver.workspaceId } } }, { participants: { some: { workspaceId: receiver.workspaceId } } }] },
      select: { id: true },
    }),
    client.dealLeg.count({ where: { fromSiteId: giver.id, status: ACTIVE, createdAt: { gte: monthStart } } }),
    client.dealLeg.count({ where: { toSiteId: receiver.id, status: ACTIVE, anchor: { equals: anchor, mode: "insensitive" } } }),
    client.dealLeg.findMany({ where: { toSiteId: receiver.id, status: ACTIVE }, select: { anchor: true } }),
    client.dealLeg.findMany({ where: { toSiteId: receiver.id, status: ACTIVE, createdAt: { gte: sixMonthsBack } }, select: { createdAt: true } }),
  ]);
  const monthIndex = (d: Date) => (d.getUTCFullYear() - sixMonthsBack.getUTCFullYear()) * 12 + d.getUTCMonth() - sixMonthsBack.getUTCMonth();
  const perMonth = [0, 0, 0, 0, 0, 0];
  for (const l of recentToTarget) perMonth[Math.min(5, Math.max(0, monthIndex(l.createdAt)))]++;

  return evaluateFootprint(
    giver,
    receiver,
    anchor,
    {
      reverseLinksRecent,
      sameLinkActive,
      pairDealsRecent: pairDeals.length,
      giverLinksThisMonth: giverLinksThisMonth + extraFromGiver,
      anchorUsesForTarget,
      linksToTarget: toTarget.length,
      keywordAnchorsToTarget: toTarget.filter((l) => classifyAnchor(l.anchor, receiver.domain, receiver.brandTerms) === "keyword").length,
      receiverLinksThisMonth: perMonth[5],
      receiverPreviousMonths: perMonth.slice(0, 5),
    },
    settings,
  );
}

export async function checkTerms(terms: Terms, sites: Map<string, FootprintSite>, client: Prisma.TransactionClient = db): Promise<FootprintResult> {
  const results = await Promise.all(
    terms.legs.map((leg, i) => {
      const giver = sites.get(leg.fromSiteId);
      const receiver = sites.get(leg.toSiteId);
      if (!giver || !receiver) return { blocks: [], warnings: [] };
      const extraFromGiver = terms.legs.filter((l, j) => j < i && l.fromSiteId === leg.fromSiteId).length;
      return checkLink(giver, receiver, leg.anchor, { client, extraFromGiver });
    }),
  );
  // Within one deal the two workspaces trade by definition; the pair warning is about repeat deals.
  return mergeResults(results);
}
