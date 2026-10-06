import "server-only";
import { db } from "@/lib/db";
import { propertyForUrl } from "@/lib/gsc";
import { dueWindows, isoDay } from "@/lib/impact";
import { withGsc } from "@/server/gsc";

// Fetch due before/after windows for verified links whose receiving site has
// Search Console connected. At most `maxCalls` Google requests per run.
export async function runImpactFetch(maxCalls = 60) {
  // Search Console keeps 16 months of data, so a receiver who connects late still gets results.
  const since = new Date(Date.now() - 480 * 86_400_000);
  const legs = await db.dealLeg.findMany({
    // D90 is the last window; once it's stored the link is done.
    where: { verifiedAt: { gte: since }, toSite: { gsc: { isNot: null } }, impacts: { none: { window: "D90" } } },
    include: { impacts: { select: { window: true } } },
    orderBy: { verifiedAt: "asc" },
    take: 500,
  });
  let calls = 0;
  let fetched = 0;
  for (const leg of legs) {
    if (calls >= maxCalls) break;
    const have = new Set(leg.impacts.map((i) => i.window));
    const todo = dueWindows(leg.verifiedAt!).filter((w) => !have.has(w.window));
    if (!todo.length) continue;
    try {
      await withGsc(leg.toSiteId, async (api, token, conn) => {
        const property = propertyForUrl(conn.properties, leg.targetUrl);
        if (!property) return;
        for (const w of todo) {
          if (calls >= maxCalls) return;
          calls++;
          const t = await api.totals(token, property, leg.targetUrl, isoDay(w.start), isoDay(w.end));
          await db.linkImpact.upsert({
            where: { legId_window: { legId: leg.id, window: w.window } },
            create: { legId: leg.id, window: w.window, startDate: w.start, endDate: w.end, ...t },
            update: { startDate: w.start, endDate: w.end, ...t, fetchedAt: new Date() },
          });
          fetched++;
        }
      });
    } catch (err) {
      console.error("[impact]", leg.id, err);
    }
  }
  return fetched;
}
