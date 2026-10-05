import type { Metadata } from "next";
import { db } from "@/lib/db";
import { resolveDisputeAction } from "@/server/actions/trust";
import { requireAdmin } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { LEG_LABEL } from "@/components/deal-status";
import { Alert, Card, Field, PageHeader, Select } from "@/components/ui";

export const metadata: Metadata = { title: "Disputes" };

export default async function DisputesPage({ searchParams }: PageProps<"/admin/disputes">) {
  await requireAdmin();
  const { msg } = await searchParams;
  const [open, closed] = await Promise.all([
    db.dispute.findMany({
      where: { status: "OPEN" },
      include: {
        openedBy: true,
        against: true,
        deal: { include: { legs: { include: { fromSite: true, toSite: true, checks: { orderBy: { checkedAt: "desc" }, take: 3 } } }, messages: { orderBy: { createdAt: "desc" }, take: 5, include: { author: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.dispute.findMany({ where: { status: { not: "OPEN" } }, include: { openedBy: true, against: true }, orderBy: { resolvedAt: "desc" }, take: 20 }),
  ]);

  return (
    <>
      <PageHeader title="Disputes" description="Decide what happens to a link and its escrow. Both sides are emailed the resolution." />
      <div className="flex max-w-4xl flex-col gap-4">
        {typeof msg === "string" && <Alert tone="success">{msg}</Alert>}
        {open.length === 0 && <p className="text-sm text-muted">No open disputes.</p>}
        {open.map((d) => (
          <Card key={d.id} title={`${d.openedBy.name} vs ${d.against.name}`} description={`Opened ${d.createdAt.toISOString().slice(0, 10)} · was ${d.previousDealStatus?.toLowerCase() ?? "-"}`}>
            <p className="text-sm whitespace-pre-wrap">{d.reason}</p>
            <ul className="mt-4 flex flex-col gap-3 text-sm">
              {d.deal.legs.map((l) => (
                <li key={l.id} className={`rounded-lg border p-3 ${l.id === d.legId ? "border-danger/50" : "border-border"}`}>
                  <div className="font-medium">
                    {l.fromSite.domain} → {l.toSite.domain} · {LEG_LABEL[l.status]} · {l.credits} cr
                  </div>
                  <div className="break-all text-muted">
                    &quot;{l.anchor}&quot; → {l.targetUrl}
                    {l.sourcePageUrl && ` · on ${l.sourcePageUrl}`}
                  </div>
                  {l.checks.map((c) => (
                    <div key={c.id} className="text-xs text-muted">
                      {c.checkedAt.toISOString().slice(0, 10)}: {c.error ?? "link found"}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
            {d.deal.messages.length > 0 && (
              <div className="mt-3 text-xs text-muted">
                Latest messages: {d.deal.messages.map((m) => `${m.author.name}: "${m.body.slice(0, 120)}"`).join(" · ")}
              </div>
            )}
            <div className="mt-4 border-t border-border pt-4">
              <ActionForm action={resolveDisputeAction} submit="Resolve">
                <input type="hidden" name="disputeId" value={d.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Outcome">
                    <Select name="outcome" defaultValue="dismiss">
                      <option value="dismiss">Dismiss - deal continues</option>
                      <option value="refund_leg">Refund the link&apos;s escrow (no fault)</option>
                      <option value="refund_and_penalize">Refund and penalise the giver</option>
                    </Select>
                  </Field>
                  <Field label="Link">
                    <Select name="legId" defaultValue={d.legId ?? ""}>
                      <option value="">-</option>
                      {d.deal.legs.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.fromSite.domain} → {l.toSite.domain}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <textarea name="note" rows={2} required minLength={5} placeholder="Resolution (sent to both sides)" aria-label="Resolution" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
              </ActionForm>
            </div>
          </Card>
        ))}
        {closed.length > 0 && (
          <Card title="Recently closed">
            <ul className="flex flex-col gap-1 text-sm text-muted">
              {closed.map((d) => (
                <li key={d.id}>
                  {d.resolvedAt?.toISOString().slice(0, 10)} · {d.openedBy.name} vs {d.against.name} · {d.status.toLowerCase()}: {d.resolution}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
