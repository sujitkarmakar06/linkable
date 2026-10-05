import "server-only";
import { priceLink } from "@/lib/credits";
import { db } from "@/lib/db";
import { getBalances, lockWorkspaces } from "@/lib/ledger";
import { pickTop, scoreCandidate } from "@/lib/matching";
import { getSettings, priceRules } from "@/lib/settings";
import { createDealFromTerms, DealError } from "@/server/deals";
import { checkLink } from "@/server/footprint";
import { notifyWorkspace } from "@/server/notify";

export const MATCHES_PER_REQUEST = 3;
export const MATCH_TTL_HOURS = 72;

const monthStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

// Offer one open request to the best available giver sites until it has
// MATCHES_PER_REQUEST live offers. Returns how many new matches were made.
export async function runMatchingForRequest(requestId: string): Promise<number> {
  const request = await db.linkRequest.findUnique({ where: { id: requestId }, include: { site: true, matches: true } });
  if (!request || request.status !== "OPEN" || !request.autoMatch) return 0;
  const now = new Date();
  const live = request.matches.filter((m) => m.status === "OFFERED" && m.expiresAt > now).length;
  const need = MATCHES_PER_REQUEST - live;
  if (need <= 0) return 0;

  const settings = await getSettings();
  const rules = priceRules(settings);
  const { available } = await getBalances(request.workspaceId);
  const niches = request.niches.length ? request.niches : [request.site.niche];
  const tried = request.matches.map((m) => m.siteId);

  const sites = await db.site.findMany({
    where: {
      status: "APPROVED",
      canGive: true,
      workspaceId: { not: request.workspaceId },
      workspace: { suspendedAt: null },
      niche: { in: niches },
      domainRating: { gte: request.minDomainRating },
      id: { notIn: tried },
    },
    include: { workspace: true },
    take: 200,
  });

  const scored = [];
  for (const site of sites) {
    const credits = priceLink({ domainRating: site.domainRating ?? 0, monthlyTraffic: site.organicTraffic, rel: request.rel, placementType: request.placementType }, rules);
    if (credits == null || credits > request.maxCredits || credits > available) continue;
    const footprint = await checkLink(site, request.site, request.anchors[0] ?? "");
    if (footprint.blocks.length) continue;
    const linksThisMonth = await db.dealLeg.count({ where: { fromSiteId: site.id, status: { notIn: ["CANCELLED", "REMOVED"] }, createdAt: { gte: monthStart() } } });
    const score = scoreCandidate(
      { niche: site.niche, domainRating: site.domainRating ?? 0, organicTraffic: site.organicTraffic, reputation: site.workspace.reputation, linksThisMonth, maxOutboundPerMonth: site.maxOutboundPerMonth },
      { siteNiche: request.site.niche },
    );
    scored.push({ site, workspaceId: site.workspaceId, credits, score, warnings: footprint.warnings });
  }

  const picked = pickTop(scored, need);
  const expiresAt = new Date(Date.now() + MATCH_TTL_HOURS * 3_600_000);
  for (const p of picked) {
    const match = await db.match.create({
      data: { linkRequestId: request.id, siteId: p.site.id, workspaceId: p.workspaceId, score: p.score, credits: p.credits, expiresAt, footprint: p.warnings.length ? { warnings: p.warnings } : undefined },
    });
    await notifyWorkspace(
      p.workspaceId,
      { kind: "match.new", title: `Earn ${p.credits} credits: a link from ${p.site.domain}`, body: `A ${request.site.niche} site needs a link that ${p.site.domain} can give. The offer is open for ${MATCH_TTL_HOURS} hours.`, path: `/app/matches#${match.id}` },
      { everyone: true },
    );
  }
  return picked.length;
}

// Periodic run (cron): expire stale offers, then top up every open request.
export async function runMatching(limit = 200) {
  const expired = await db.match.updateMany({ where: { status: "OFFERED", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
  const requests = await db.linkRequest.findMany({ where: { status: "OPEN", autoMatch: true }, select: { id: true }, orderBy: { createdAt: "asc" }, take: limit });
  let created = 0;
  for (const r of requests) {
    try {
      created += await runMatchingForRequest(r.id);
    } catch (err) {
      console.error(`[matching] request ${r.id}:`, err);
    }
  }
  return { expired: expired.count, requests: requests.length, created };
}

export async function acceptMatch(matchId: string, workspaceId: string, anchor: string, userId: string): Promise<string> {
  const match = await db.match.findUnique({ where: { id: matchId }, include: { linkRequest: { include: { site: true } }, site: true } });
  if (!match || match.workspaceId !== workspaceId) throw new DealError("Match not found.");
  const request = match.linkRequest;
  if (!request.anchors.includes(anchor)) throw new DealError("Pick one of the requested anchors.");

  const dealId = await db.$transaction(async (tx) => {
    await lockWorkspaces(tx, [workspaceId, request.workspaceId]);
    const fresh = await tx.match.findUniqueOrThrow({ where: { id: matchId } });
    if (fresh.status !== "OFFERED" || fresh.expiresAt <= new Date()) throw new DealError("This match has expired or was taken by another site.");
    const req = await tx.linkRequest.findUniqueOrThrow({ where: { id: request.id } });
    if (req.status !== "OPEN") throw new DealError("This request has already been fulfilled or cancelled.");
    const id = await createDealFromTerms(tx, {
      source: "AUTO_MATCH",
      kind: "REQUEST_OFFER",
      terms: { legs: [{ fromSiteId: match.siteId, toSiteId: request.siteId, targetUrl: request.targetUrl, anchor, rel: request.rel, placementType: request.placementType, credits: fresh.credits }] },
      parties: [workspaceId, request.workspaceId],
      linkRequestId: request.id,
      actingWorkspaceId: workspaceId,
      userId,
    });
    await tx.match.update({ where: { id: matchId }, data: { status: "ACCEPTED", dealId: id } });
    return id;
  });

  await notifyWorkspace(
    request.workspaceId,
    { kind: "match.accepted", title: `${match.site.domain} will link to ${request.site.domain}`, body: `Your request was matched automatically. ${match.credits} credits are held in escrow until you confirm the link is live.`, path: `/app/deals/${dealId}` },
    { everyone: true },
  );
  return dealId;
}

export async function declineMatch(matchId: string, workspaceId: string) {
  const { count } = await db.match.updateMany({ where: { id: matchId, workspaceId, status: "OFFERED" }, data: { status: "DECLINED" } });
  if (count) {
    const m = await db.match.findUniqueOrThrow({ where: { id: matchId } });
    await runMatchingForRequest(m.linkRequestId); // offer it to the next best site
  }
}
