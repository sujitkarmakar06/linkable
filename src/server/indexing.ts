import "server-only";
import { db } from "@/lib/db";
import { propertyForUrl } from "@/lib/gsc";
import { INDEX_RECHECK_HOURS, INDEX_REMINDER_DAYS_LEFT } from "@/lib/indexing";
import { lockWorkspaces } from "@/lib/ledger";
import { refundLeg } from "@/server/deals";
import { withGsc } from "@/server/gsc";
import { notifyWorkspace } from "@/server/notify";

// Links whose page we're waiting on Google to index. Disputed deals are paused.
const waiting = { indexState: "PENDING" as const, status: { in: ["VERIFIED" as const, "FAILING" as const] }, deal: { status: { not: "DISPUTED" as const } } };

// Ask the host's Search Console whether each pending page is indexed. Returns
// the legs that just became indexed, so their escrow can be released.
export async function runIndexChecks(limit = 40): Promise<{ checked: number; indexed: string[] }> {
  const legs = await db.dealLeg.findMany({
    where: { ...waiting, sourcePageUrl: { not: null }, OR: [{ indexCheckedAt: null }, { indexCheckedAt: { lt: new Date(Date.now() - INDEX_RECHECK_HOURS * 3_600_000) } }] },
    include: { fromSite: true, toSite: true },
    orderBy: { indexCheckedAt: { sort: "asc", nulls: "first" } },
    take: limit,
  });
  const indexed: string[] = [];
  for (const leg of legs) {
    const url = leg.sourcePageUrl!;
    let result: { indexed: boolean; coverage: string } | null = null;
    try {
      result = await withGsc(leg.fromSiteId, async (api, token, conn) => {
        const property = propertyForUrl(conn.properties, url);
        if (!property) return { indexed: false, coverage: "No connected Search Console property covers this page" };
        return api.inspect(token, property, url);
      });
    } catch (err) {
      console.error("[indexing]", leg.id, err);
      result = null;
    }
    const now = new Date();
    if (!result) {
      // No connection (or Google refused it): try again on the next run.
      await db.dealLeg.updateMany({ where: { id: leg.id, indexState: "PENDING" }, data: { indexCheckedAt: now } });
      continue;
    }
    const { count } = await db.dealLeg.updateMany({
      where: { id: leg.id, indexState: "PENDING" },
      data: { indexCheckedAt: now, indexCoverage: result.coverage, ...(result.indexed ? { indexState: "INDEXED", indexedAt: now } : {}) },
    });
    if (count && result.indexed) {
      indexed.push(leg.id);
      for (const ws of [leg.giverWorkspaceId, leg.receiverWorkspaceId])
        await notifyWorkspace(ws, {
          kind: "leg.indexed",
          title: `Indexed: link from ${leg.fromSite.domain} to ${leg.toSite.domain}`,
          body: "Google has indexed the page with the link. Escrowed credits are now released on schedule.",
          path: `/app/deals/${leg.dealId}`,
        });
    }
  }
  return { checked: legs.length, indexed };
}

// One reminder to the host a week before the deadline.
export async function remindUnindexed() {
  const legs = await db.dealLeg.findMany({
    where: { ...waiting, indexReminderAt: null, indexDeadline: { lt: new Date(Date.now() + INDEX_REMINDER_DAYS_LEFT * 86_400_000) } },
    include: { fromSite: { include: { gsc: true } }, toSite: true },
    take: 500,
  });
  for (const leg of legs) {
    const { count } = await db.dealLeg.updateMany({ where: { id: leg.id, indexReminderAt: null }, data: { indexReminderAt: new Date() } });
    if (!count) continue;
    const hint = leg.fromSite.gsc ? "Make sure the page is linked from your site and request indexing in Search Console." : `Connect Google Search Console for ${leg.fromSite.domain} so Linkable can confirm it.`;
    await notifyWorkspace(
      leg.giverWorkspaceId,
      {
        kind: "leg.index_reminder",
        title: `Not indexed yet: your link to ${leg.toSite.domain}`,
        body: `Google hasn't indexed ${leg.sourcePageUrl} yet. ${hint} If it isn't indexed by ${leg.indexDeadline?.toISOString().slice(0, 10)}, the credits go back to the receiver.`,
        path: `/app/deals/${leg.dealId}`,
      },
      { everyone: true },
    );
  }
  return legs.length;
}

// Deadline passed without indexing: refund whatever is still in escrow.
export async function expireUnindexed() {
  const legs = await db.dealLeg.findMany({ where: { ...waiting, indexDeadline: { lt: new Date() } }, include: { fromSite: true, toSite: true }, take: 500 });
  let expired = 0;
  for (const leg of legs) {
    const done = await db.$transaction(async (tx) => {
      await lockWorkspaces(tx, [leg.giverWorkspaceId, leg.receiverWorkspaceId]);
      const fresh = await tx.dealLeg.findUniqueOrThrow({ where: { id: leg.id }, include: { deal: true } });
      if (fresh.indexState !== "PENDING" || fresh.deal.status === "DISPUTED" || !["VERIFIED", "FAILING"].includes(fresh.status)) return false;
      await tx.dealLeg.update({ where: { id: leg.id }, data: { indexState: "EXPIRED" } });
      await refundLeg(tx, fresh, null);
      await tx.auditLog.create({ data: { action: "leg.index_expired", target: leg.id, meta: { coverage: fresh.indexCoverage } } });
      return true;
    });
    if (!done) continue;
    expired++;
    for (const ws of [leg.giverWorkspaceId, leg.receiverWorkspaceId])
      await notifyWorkspace(
        ws,
        {
          kind: "leg.not_indexed",
          title: `Not indexed: link from ${leg.fromSite.domain} to ${leg.toSite.domain}`,
          body: "Google didn't index the page with the link before the deadline, so the escrowed credits went back to the receiver.",
          path: `/app/deals/${leg.dealId}`,
        },
        { everyone: true },
      );
  }
  return expired;
}
