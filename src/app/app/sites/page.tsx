import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { requireMembership } from "@/server/session";
import { formatNumber, SiteStatusBadge } from "@/components/site-status";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Sites" };

export default async function SitesPage() {
  const { membership, workspace } = await requireMembership();
  const [sites, settings] = await Promise.all([db.site.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } }), getSettings()]);
  const active = sites.filter((s) => s.status !== "REJECTED").length;
  const canAdd = hasRole(membership.role, "ADMIN") && (workspace.plan !== "FREE" || active < settings.freeMaxSites);

  return (
    <>
      <PageHeader title="Sites" description={`${active} of ${settings.freeMaxSites} on the free plan · Minimum DR ${settings.minDomainRating}, ${formatNumber(settings.minMonthlyTraffic)} visits/month`}>
        {canAdd && (
          <Link href="/app/sites/new" className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg">
            Add a site
          </Link>
        )}
      </PageHeader>
      {sites.length === 0 ? (
        <Card title="No sites yet" description="Add a site you own. You'll prove ownership, we'll check its metrics, and an admin reviews it before it goes live." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                {["Domain", "Status", "Niche", "DR", "Traffic/mo", "Uses"].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link href={`/app/sites/${s.id}`} className="font-medium text-accent">
                      {s.domain}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <SiteStatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3">{s.niche}</td>
                  <td className="px-4 py-3 tabular-nums">{formatNumber(s.domainRating)}</td>
                  <td className="px-4 py-3 tabular-nums">{formatNumber(s.organicTraffic)}</td>
                  <td className="px-4 py-3 text-muted">{[s.canGive && "Gives", s.canReceive && "Receives"].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
