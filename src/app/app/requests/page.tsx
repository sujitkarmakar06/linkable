import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { requireMembership } from "@/server/session";
import { RequestStatusBadge } from "@/components/request-status";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Link requests" };

export default async function RequestsPage() {
  const { workspace } = await requireMembership();
  const [requests, settings] = await Promise.all([
    db.linkRequest.findMany({ where: { workspaceId: workspace.id }, include: { site: true, _count: { select: { proposals: { where: { status: "OPEN" } } } } }, orderBy: { createdAt: "desc" } }),
    getSettings(),
  ]);
  const open = requests.filter((r) => r.status === "OPEN" || r.status === "MATCHED").length;
  return (
    <>
      <PageHeader title="Link requests" description={`Ask for a link and pay in credits. ${open} of ${settings.freeMaxOpenRequests} open on the free plan.`}>
        <Link href="/app/requests/new" className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg">
          New request
        </Link>
      </PageHeader>
      {requests.length === 0 ? (
        <Card title="No requests yet" description="Post a request for a link to one of your approved sites. Other workspaces offer links from their sites, and you pay with credits held in escrow." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                {["Target", "Status", "Offers", "Pays up to"].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link href={`/app/requests/${r.id}`} className="font-medium text-accent">
                      {r.targetUrl}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <RequestStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 tabular-nums">{r._count.proposals}</td>
                  <td className="px-4 py-3 tabular-nums">{r.maxCredits} cr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
