import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getBalances } from "@/lib/ledger";
import { getSettings } from "@/lib/settings";
import { requireMembership } from "@/server/session";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Credits" };

const REASON: Record<string, string> = {
  SIGNUP_GRANT: "Starter credits",
  ESCROW_LOCK: "Held in escrow",
  ESCROW_RELEASE: "Escrow released",
  ESCROW_REFUND: "Escrow refunded",
  PENALTY: "Penalty",
  ADMIN_ADJUSTMENT: "Adjustment",
};

export default async function CreditsPage() {
  const { workspace } = await requireMembership();
  const [balances, entries, settings, upcoming] = await Promise.all([
    getBalances(workspace.id),
    db.creditEntry.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" }, take: 200 }),
    getSettings(),
    db.escrowRelease.aggregate({
      where: { releasedAt: null, cancelledAt: null, legId: { in: (await db.dealLeg.findMany({ where: { giverWorkspaceId: workspace.id }, select: { id: true } })).map((l) => l.id) } },
      _sum: { amount: true },
    }),
  ]);
  return (
    <>
      <PageHeader title="Credits" description="Earn credits by placing links for others; spend them on links to your sites.">
        <div className="flex flex-wrap gap-2 text-sm">
          {[
            ["ledger", "Credits CSV"],
            ["links", "Links CSV"],
            ["checks", "Link checks CSV"],
          ].map(([k, l]) => (
            <a key={k} href={`/api/export/${k}`} className="rounded-md border border-border px-3 py-1.5 hover:border-accent">
              {l}
            </a>
          ))}
        </div>
      </PageHeader>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          ["Available", balances.available, "Ready to spend"],
          ["In escrow", balances.escrow, "Locked for links you're receiving"],
          ["Coming to you", upcoming._sum.amount ?? 0, "Scheduled releases for links you placed"],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-xl border border-border bg-surface p-4">
            <div className="text-sm text-muted">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 text-xs text-muted">{hint}</div>
          </div>
        ))}
      </div>
      <Card title="History" description={`Prices: ${settings.creditTiers.map((t) => `DR ${t.minDr}-${t.maxDr} = ${t.credits}`).join(", ")}.`}>
        {entries.length === 0 ? (
          <p className="text-sm text-muted">No credit movements yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  {["Date", "What", "Balance", "Amount", ""].map((h, i) => (
                    <th key={i} className="py-2 pr-4 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="py-2 pr-4 whitespace-nowrap">{e.createdAt.toISOString().slice(0, 10)}</td>
                    <td className="py-2 pr-4">{REASON[e.reason] ?? e.reason}</td>
                    <td className="py-2 pr-4 text-muted">{e.bucket === "ESCROW" ? "Escrow" : "Available"}</td>
                    <td className={`py-2 pr-4 tabular-nums ${e.amount > 0 ? "text-success" : ""}`}>{e.amount > 0 ? `+${e.amount}` : e.amount}</td>
                    <td className="py-2">
                      {e.dealId && (
                        <Link href={`/app/deals/${e.dealId}`} className="text-accent">
                          Deal
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
