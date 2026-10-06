import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/session";
import { BarChart } from "@/components/bar-chart";
import { DEAL_LABEL } from "@/components/deal-status";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Analytics" };

// Claude Opus 5.5 list prices, USD per million tokens (input / output).
const AI_PRICE = { input: 4, output: 20 };

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

// Data loading lives outside the component (render must stay pure).
async function loadStats() {
  const now = Date.now();
  const monthStart = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1));
  const weeksAgo = new Date(now - 12 * 7 * 86_400_000);
  const [users, newUsers, workspaces, sites, liveLinks, removed, openDisputes, dealsByStatus, weekly, buckets, penalties, ai] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: monthStart } } }),
    db.workspace.count(),
    db.site.count({ where: { status: "APPROVED" } }),
    db.dealLeg.count({ where: { status: "VERIFIED" } }),
    db.dealLeg.count({ where: { status: "REMOVED" } }),
    db.dispute.count({ where: { status: "OPEN" } }),
    db.deal.groupBy({ by: ["status"], _count: true }),
    db.$queryRaw<{ week: Date; n: bigint }[]>`SELECT date_trunc('week', "createdAt") AS week, count(*) AS n FROM "Deal" WHERE "createdAt" >= ${weeksAgo} GROUP BY 1 ORDER BY 1`,
    db.creditEntry.groupBy({ by: ["bucket"], _sum: { amount: true } }),
    db.creditEntry.aggregate({ where: { reason: "PENALTY", bucket: "AVAILABLE", amount: { gt: 0 } }, _sum: { amount: true } }),
    db.aiUsage.groupBy({ by: ["kind"], where: { createdAt: { gte: monthStart } }, _count: true, _sum: { inputTokens: true, outputTokens: true } }),
  ]);

  // 12 weekly buckets (Monday starts), including empty weeks.
  const counts = new Map(weekly.map((w) => [new Date(w.week).toISOString().slice(0, 10), Number(w.n)]));
  const monday = new Date(now);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const series = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(monday.getTime() - (11 - i) * 7 * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    return { x: key.slice(5), y: counts.get(key) ?? 0 };
  });

  const bucket = (b: string) => buckets.find((x) => x.bucket === b)?._sum.amount ?? 0;
  const survival = liveLinks + removed ? Math.round((liveLinks / (liveLinks + removed)) * 100) : null;
  const aiCost = ai.reduce((s, r) => s + ((r._sum.inputTokens ?? 0) * AI_PRICE.input + (r._sum.outputTokens ?? 0) * AI_PRICE.output) / 1_000_000, 0);
  return { users, newUsers, workspaces, sites, liveLinks, openDisputes, dealsByStatus, series, bucket, penalties, ai, survival, aiCost };
}

export default async function AnalyticsPage() {
  await requireAdmin();
  const { users, newUsers, workspaces, sites, liveLinks, openDisputes, dealsByStatus, series, bucket, penalties, ai, survival, aiCost } = await loadStats();

  return (
    <>
      <PageHeader title="Analytics" description="Platform health at a glance. Exports download as CSV." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Users" value={users.toLocaleString("en")} hint={`${newUsers} new this month`} />
        <Tile label="Workspaces" value={workspaces.toLocaleString("en")} hint={`${sites} approved sites`} />
        <Tile label="Live links" value={liveLinks.toLocaleString("en")} hint={survival == null ? "No removals yet" : `${survival}% survival (live vs removed)`} />
        <Tile label="Open disputes" value={String(openDisputes)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="Deals created per week" description="Last 12 weeks (week starting Monday, UTC).">
          <BarChart data={series} label="Deals created per week, last 12 weeks" valueLabel="deals" />
        </Card>
        <Card title="Deals by status">
          <table className="w-full text-sm">
            <tbody>
              {dealsByStatus.map((d) => (
                <tr key={d.status} className="border-t border-border first:border-0">
                  <td className="py-1.5 text-muted">{DEAL_LABEL[d.status]}</td>
                  <td className="py-1.5 text-right tabular-nums">{d._count}</td>
                </tr>
              ))}
              {dealsByStatus.length === 0 && (
                <tr>
                  <td className="text-muted">No deals yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <Card title="Credit economy" description="Should always net to zero across all accounts.">
          <table className="w-full text-sm">
            <tbody>
              {[
                ["Available (all workspaces)", bucket("AVAILABLE")],
                ["Held in escrow", bucket("ESCROW")],
                ["Issued by the platform", -bucket("PLATFORM")],
                ["Penalties paid", penalties._sum.amount ?? 0],
                ["Net (must be 0)", bucket("AVAILABLE") + bucket("ESCROW") + bucket("PLATFORM")],
              ].map(([k, v]) => (
                <tr key={k} className="border-t border-border first:border-0">
                  <td className="py-1.5 text-muted">{k}</td>
                  <td className="py-1.5 text-right tabular-nums">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="AI this month" description={`Estimated at $${AI_PRICE.input}/$${AI_PRICE.output} per million input/output tokens.`}>
          <table className="w-full text-sm">
            <tbody>
              {ai.map((r) => (
                <tr key={r.kind} className="border-t border-border first:border-0">
                  <td className="py-1.5 text-muted">{r.kind}</td>
                  <td className="py-1.5 text-right tabular-nums">{r._count} calls</td>
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="py-1.5 font-medium">Estimated spend</td>
                <td className="py-1.5 text-right font-medium tabular-nums">${aiCost.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title="CSV exports">
          <ul className="flex flex-wrap gap-2 text-sm">
            {["users", "workspaces", "deals", "disputes"].map((k) => (
              <li key={k}>
                <a href={`/api/admin/export/${k}`} className="inline-flex rounded-md border border-border px-3 py-1.5 hover:border-accent">
                  {k}.csv
                </a>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
