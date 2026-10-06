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
  // Matching can be triggered from several places at once (new request, site
  // approval, cron, admin button, a decline). A per-request advisory lock makes
  // each run see the previous run's offers, so a request never gets more than
  // MATCHES_PER_REQUEST live offers or two offers to the same workspace.
  const created = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"match:" + requestId}))`;
      const request = await tx.linkRequest.findUnique({ where: { id: requestId }, include: { site: true, matches: true } });
      if (!request || request.status !== "OPEN" || !request.autoMatch) return [];
      const now = new Date();
      const liveMatches = request.matches.filter((m) => m.status === "OFFERED" && m.expiresAt > now);
      const need = MATCHES_PER_REQUEST - liveMatches.length;
      if (need <= 0) return [];

      const settings = await getSettings();
      const rules = priceRules(settings);
      const { available } = await getBalances(request.workspaceId);
      const niches = request.niches.length ? request.niches : [request.site.niche];
      const tried = request.matches.map((m) => m.siteId);
      // One offer per workspace: skip workspaces holding a live offer, and ones
      // that already declined this request.
      const excludedWorkspaces = [
        ...new Set([...liveMatches.map((m) => m.workspaceId), ...request.matches.filter((m) => m.status === "DECLINED").map((m) => m.workspaceId)]),
      ];

      const sites = await tx.site.findMany({
        where: {
          status: "APPROVED",
          canGive: true,
          workspaceId: { notIn: [request.workspaceId, ...excludedWorkspaces] },
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
        const footprint = await checkLink(site, request.site, request.anchors[0] ?? "", { client: tx });
        if (footprint.blocks.length) continue;
        const linksThisMonth = await tx.dealLeg.count({ where: { fromSiteId: site.id, status: { notIn: ["CANCELLED", "REMOVED"] }, createdAt: { gte: monthStart() } } });
        const score = scoreCandidate(
          { niche: site.niche, domainRating: site.domainRating ?? 0, organicTraffic: site.organicTraffic, reputation: site.workspace.reputation, linksThisMonth, maxOutboundPerMonth: site.maxOutboundPerMonth },
          { siteNiche: request.site.niche },
        );
        scored.push({ site, workspaceId: site.workspaceId, credits, score, warnings: footprint.warnings });
      }

      const expiresAt = new Date(Date.now() + MATCH_TTL_HOURS * 3_600_000);
      const made = [];
      for (const p of pickTop(scored, need)) {
        const match = await tx.match.create({
          data: { linkRequestId: request.id, siteId: p.site.id, workspaceId: p.workspaceId, score: p.score, credits: p.credits, expiresAt, footprint: p.warnings.length ? { warnings: p.warnings } : undefined },
        });
        made.push({ match, domain: p.site.domain, credits: p.credits, workspaceId: p.workspaceId, niche: request.site.niche });
      }
      return made;
    },
    { timeout: 60_000, maxWait: 30_000 },
  );

  // Notify after commit, outside the lock.
  for (const m of created)
    await notifyWorkspace(
      m.workspaceId,
      { kind: "match.new", title: `Earn ${m.credits} credits: a link from ${m.domain}`, body: `A ${m.niche} site needs a link that ${m.domain} can give. The offer is open for ${MATCH_TTL_HOURS} hours.`, path: `/app/matches#${m.match.id}` },
      { everyone: true },
    );
  return created.length;
}

// Periodic run (cron): expire stale offers, then top up every open request.
export async function runMatching(maxRequests = 2000) {
  const expired = await db.match.updateMany({ where: { status: "OFFERED", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
  // Walk all open requests in pages (oldest first) so newer ones aren't starved
  // by old requests that never find a candidate.
  let created = 0;
  let seen = 0;
  let cursor: string | undefined;
  while (seen < maxRequests) {
    const page = await db.linkRequest.findMany({
      where: { status: "OPEN", autoMatch: true },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    for (const r of page) {
      try {
        created += await runMatchingForRequest(r.id);
      } catch (err) {
        console.error(`[matching] request ${r.id}:`, err);
      }
    }
    seen += page.length;
    cursor = page[page.length - 1].id;
  }
  return { expired: expired.count, requests: seen, created };
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
    // Offer it to the next best site. The decline already succeeded, so a
    // matching failure here is logged, not shown to the user (the cron retries).
    await runMatchingForRequest(m.linkRequestId).catch((err) => console.error("[matching] re-offer:", err));
  }
}
