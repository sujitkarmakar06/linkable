import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { cancelDealAction, confirmLegAction, placeLegAction } from "@/server/actions/deals";
import { requireMembership } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { DEAL_LABEL, LEG_LABEL, Pill } from "@/components/deal-status";
import { Flash } from "@/components/flash";
import { Thread } from "@/components/thread";
import { Card, Field, Input, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Deal" };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

export default async function DealPage({ params, searchParams }: PageProps<"/app/deals/[id]">) {
  const { id } = await params;
  const { done } = await searchParams;
  const { membership, workspace } = await requireMembership();
  const deal = await db.deal.findFirst({
    where: { id, participants: { some: { workspaceId: workspace.id } } },
    include: { legs: { include: { fromSite: true, toSite: true }, orderBy: { createdAt: "asc" } }, participants: { include: { workspace: true } } },
  });
  if (!deal) notFound();
  const names = new Map(deal.participants.map((p) => [p.workspaceId, p.workspace.name]));
  const canAct = hasRole(membership.role, "MEMBER");
  const cancellable = !["CANCELLED", "COMPLETED"].includes(deal.status) && deal.legs.every((l) => !["PLACED", "VERIFIED"].includes(l.status));

  return (
    <>
      <PageHeader title={`Deal with ${deal.participants.filter((p) => p.workspaceId !== workspace.id).map((p) => p.workspace.name).join(", ")}`} description={`Agreed ${day(deal.createdAt)}${deal.guaranteeEnds ? ` · guaranteed until ${day(deal.guaranteeEnds)}` : ""}`}>
        <Pill tone={deal.status === "LIVE" ? "success" : deal.status === "CANCELLED" ? "danger" : "muted"}>{DEAL_LABEL[deal.status]}</Pill>
      </PageHeader>
      <div className="flex max-w-3xl flex-col gap-4">
        <Flash done={done} />
        {deal.legs.map((leg, i) => {
          const giving = leg.giverWorkspaceId === workspace.id;
          const receiving = leg.receiverWorkspaceId === workspace.id;
          return (
            <Card key={leg.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm">
                  <div className="font-semibold">
                    {i + 1}. {leg.fromSite.domain} → {leg.toSite.domain}
                  </div>
                  <div className="text-muted">
                    {giving ? "You place this link" : `${names.get(leg.giverWorkspaceId)} places this link`} · due {day(leg.dueAt)}
                  </div>
                </div>
                <Pill tone={leg.status === "VERIFIED" ? "success" : leg.status === "CANCELLED" ? "danger" : "muted"}>{LEG_LABEL[leg.status]}</Pill>
              </div>
              <dl className="mt-3 grid gap-2 text-sm">
                <div>
                  <dt className="inline text-muted">Anchor: </dt>
                  <dd className="inline">&quot;{leg.anchor}&quot; ({leg.rel.toLowerCase()}, {leg.placementType === "GUEST_POST" ? "guest post" : "insertion"})</dd>
                </div>
                <div className="break-all">
                  <dt className="inline text-muted">Links to: </dt>
                  <dd className="inline">{leg.targetUrl}</dd>
                </div>
                {leg.sourcePageUrl && (
                  <div className="break-all">
                    <dt className="inline text-muted">Placed on: </dt>
                    <dd className="inline">
                      <a href={leg.sourcePageUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent">
                        {leg.sourcePageUrl}
                      </a>
                    </dd>
                  </div>
                )}
                {leg.credits > 0 && (
                  <div>
                    <dt className="inline text-muted">Credits: </dt>
                    <dd className="inline">
                      {leg.credits} in escrow from {names.get(leg.receiverWorkspaceId)}, released to the giver in stages over the guarantee (about 40% on confirmation, then at 3, 6 and 12 months)
                    </dd>
                  </div>
                )}
              </dl>
              {canAct && giving && ["PENDING", "PLACED"].includes(leg.status) && deal.status !== "CANCELLED" && (
                <div className="mt-4 border-t border-border pt-4">
                  <ActionForm action={placeLegAction} submit={leg.status === "PLACED" ? "Update page URL" : "Mark as placed"}>
                    <input type="hidden" name="legId" value={leg.id} />
                    <Field label={`Page on ${leg.fromSite.domain} where the link is`}>
                      <Input name="sourcePageUrl" type="url" defaultValue={leg.sourcePageUrl ?? ""} placeholder={`https://${leg.fromSite.domain}/...`} required />
                    </Field>
                  </ActionForm>
                </div>
              )}
              {canAct && receiving && leg.status === "PLACED" && (
                <div className="mt-4 border-t border-border pt-4">
                  <ActionForm action={confirmLegAction} submit="Confirm the link is live">
                    <input type="hidden" name="legId" value={leg.id} />
                    <p className="text-sm text-muted">Open the page above and check the link, anchor and rel. Automatic weekly checks start in Phase 4.</p>
                  </ActionForm>
                </div>
              )}
            </Card>
          );
        })}

        {canAct && cancellable && (
          <Card title="Cancel deal" description="Possible until a link has been placed. Escrowed credits are returned.">
            <ActionForm action={cancelDealAction} submit="Cancel this deal" variant="danger">
              <input type="hidden" name="dealId" value={deal.id} />
            </ActionForm>
          </Card>
        )}

        <Thread dealId={deal.id} workspaceIds={deal.participants.map((p) => p.workspaceId)} canPost={canAct} />
      </div>
    </>
  );
}
