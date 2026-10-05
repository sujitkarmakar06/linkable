import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireMembership } from "@/server/session";
import { DEAL_LABEL, Pill } from "@/components/deal-status";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Deals" };

export default async function DealsPage() {
  const { workspace } = await requireMembership();
  const deals = await db.deal.findMany({
    where: { participants: { some: { workspaceId: workspace.id } } },
    include: { legs: { include: { fromSite: true, toSite: true } }, participants: { include: { workspace: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return (
    <>
      <PageHeader title="Deals" description="Agreed exchanges. Place your links, confirm theirs, and track the guarantee." />
      {deals.length === 0 ? (
        <Card title="No deals yet" description="Accept a proposal or an offer and it shows up here." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                {["Partner", "Links", "Status", "Your to-dos"].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => {
                const partner = d.participants.find((p) => p.workspaceId !== workspace.id)?.workspace;
                const todo =
                  d.legs.filter((l) => l.giverWorkspaceId === workspace.id && l.status === "PENDING").length +
                  d.legs.filter((l) => l.receiverWorkspaceId === workspace.id && l.status === "PLACED").length;
                return (
                  <tr key={d.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <Link href={`/app/deals/${d.id}`} className="font-medium text-accent">
                        {partner?.name ?? "-"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted">{d.legs.map((l) => `${l.fromSite.domain} → ${l.toSite.domain}`).join(", ")}</td>
                    <td className="px-4 py-3">
                      <Pill tone={d.status === "LIVE" ? "success" : d.status === "CANCELLED" ? "danger" : "muted"}>{DEAL_LABEL[d.status]}</Pill>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{todo || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
