import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireMembership } from "@/server/session";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Proposals" };

export default async function ProposalsPage() {
  const { workspace } = await requireMembership();
  const proposals = await db.proposal.findMany({
    where: { OR: [{ fromWorkspaceId: workspace.id }, { toWorkspaceId: workspace.id }] },
    include: { fromWorkspace: true, toWorkspace: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const groups = [
    { title: "Waiting for you", items: proposals.filter((p) => p.status === "OPEN" && p.awaitingWorkspaceId === workspace.id) },
    { title: "Waiting for them", items: proposals.filter((p) => p.status === "OPEN" && p.awaitingWorkspaceId !== workspace.id) },
    { title: "Closed", items: proposals.filter((p) => p.status !== "OPEN") },
  ];
  return (
    <>
      <PageHeader title="Proposals" description="ABC swap proposals and offers on link requests." />
      <div className="flex max-w-3xl flex-col gap-4">
        {groups.map((g) => (
          <Card key={g.title} title={`${g.title} (${g.items.length})`}>
            {g.items.length === 0 ? (
              <p className="text-sm text-muted">Nothing here.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {g.items.map((p) => {
                  const other = p.fromWorkspaceId === workspace.id ? p.toWorkspace : p.fromWorkspace;
                  return (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
                      <span>
                        {p.kind === "SWAP" ? "ABC swap" : "Offer"} {p.fromWorkspaceId === workspace.id ? "to" : "from"} <strong>{other.name}</strong>
                        <span className="text-muted"> · {p.status.toLowerCase()} · rev {p.revision}</span>
                      </span>
                      <Link href={`/app/proposals/${p.id}`} className="text-accent">
                        Open
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
