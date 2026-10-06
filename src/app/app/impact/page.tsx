import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { formatChange, positionChange } from "@/lib/impact";
import { requireMembership } from "@/server/session";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Impact" };

const LATEST = ["D90", "D60", "D30"] as const;
const LABEL: Record<(typeof LATEST)[number], string> = { D30: "30 days", D60: "60 days", D90: "90 days" };

// Every link this workspace received, with its page's Google numbers before
// the link and in the latest window after it.
export default async function ImpactPage() {
  const { workspace } = await requireMembership();
  const legs = await db.dealLeg.findMany({
    where: { receiverWorkspaceId: workspace.id, verifiedAt: { not: null } },
    include: { fromSite: true, toSite: { include: { gsc: { select: { id: true } } } }, impacts: true },
    orderBy: { verifiedAt: "desc" },
    take: 200,
  });
  const unconnected = [...new Map(legs.filter((l) => !l.toSite.gsc).map((l) => [l.toSiteId, l.toSite])).values()];

  return (
    <>
      <PageHeader title="Impact" description="How each link you received changed the linked page's Google clicks, impressions and position (28-day windows, from your Search Console)." />
      <div className="flex max-w-4xl flex-col gap-4">
        {unconnected.length > 0 && (
          <Card>
            <p className="text-sm">
              Connect Search Console to measure impact for:{" "}
              {unconnected.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ", "}
                  <Link href={`/app/sites/${s.id}`} className="text-accent">
                    {s.domain}
                  </Link>
                </span>
              ))}
            </p>
          </Card>
        )}
        <Card>
          {legs.length === 0 ? (
            <p className="text-sm text-muted">No live links yet. Impact appears here once a link you receive has been verified.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-normal">Link</th>
                    <th className="py-1 pr-3 font-normal">Live since</th>
                    <th className="py-1 pr-3 text-right font-normal">Clicks</th>
                    <th className="py-1 pr-3 text-right font-normal">Impressions</th>
                    <th className="py-1 text-right font-normal">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {legs.map((leg) => {
                    const by = new Map(leg.impacts.map((i) => [i.window, i]));
                    const base = by.get("BASELINE");
                    const latestKey = LATEST.find((w) => by.has(w));
                    const latest = latestKey ? by.get(latestKey) : undefined;
                    return (
                      <tr key={leg.id} className="border-t border-border align-top">
                        <td className="py-2 pr-3">
                          <Link href={`/app/deals/${leg.dealId}`} className="font-medium text-accent">
                            {leg.fromSite.domain} → {leg.toSite.domain}
                          </Link>
                          <div className="max-w-xs truncate text-xs text-muted">{leg.targetUrl}</div>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">{leg.verifiedAt!.toISOString().slice(0, 10)}</td>
                        {!leg.toSite.gsc ? (
                          <td colSpan={3} className="py-2 text-right text-muted">
                            Search Console not connected
                          </td>
                        ) : base && latest && latestKey ? (
                          <>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {base.clicks} → {latest.clicks}
                              <div className="text-xs text-muted">
                                {formatChange(base.clicks, latest.clicks)} at {LABEL[latestKey]}
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {base.impressions.toLocaleString("en")} → {latest.impressions.toLocaleString("en")}
                              <div className="text-xs text-muted">{formatChange(base.impressions, latest.impressions)}</div>
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {base.position?.toFixed(1) ?? "-"} → {latest.position?.toFixed(1) ?? "-"}
                              <div className="text-xs text-muted">{positionChange(base.position, latest.position)}</div>
                            </td>
                          </>
                        ) : (
                          <td colSpan={3} className="py-2 text-right text-muted">
                            {base ? "First result 30 days after the link went live" : "Waiting for Search Console data"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
