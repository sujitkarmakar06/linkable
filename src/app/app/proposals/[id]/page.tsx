import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getBalances } from "@/lib/ledger";
import { hasRole } from "@/lib/roles";
import { getSettings, priceRules } from "@/lib/settings";
import { summarise, type Terms } from "@/lib/terms";
import { acceptAction, closeProposalAction, counterAction } from "@/server/actions/proposals";
import { checkTerms as checkFootprint } from "@/server/footprint";
import { requireMembership } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { LegsEditor } from "@/components/legs-editor";
import { LegsTable } from "@/components/legs-table";
import { Flash } from "@/components/flash";
import { FootprintNotes } from "@/components/footprint-notes";
import { Thread } from "@/components/thread";
import { Button, Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Proposal" };

export default async function ProposalPage({ params, searchParams }: PageProps<"/app/proposals/[id]">) {
  const { id } = await params;
  const { done } = await searchParams;
  const { membership, workspace } = await requireMembership();
  const proposal = await db.proposal.findFirst({
    where: { id, OR: [{ fromWorkspaceId: workspace.id }, { toWorkspaceId: workspace.id }] },
    include: { fromWorkspace: true, toWorkspace: true },
  });
  if (!proposal) notFound();
  const terms = proposal.terms as Terms;
  const parties = [proposal.fromWorkspaceId, proposal.toWorkspaceId];
  const [allSites, settings, balances] = await Promise.all([
    db.site.findMany({ where: { OR: [{ workspaceId: { in: parties }, status: "APPROVED" }, { id: { in: terms.legs.flatMap((l) => [l.fromSiteId, l.toSiteId]) } }] } }),
    getSettings(),
    getBalances(workspace.id),
  ]);
  const sites = new Map(allSites.map((s) => [s.id, s]));
  const names = new Map([proposal.fromWorkspace, proposal.toWorkspace].map((w) => [w.id, w.name]));
  const other = proposal.fromWorkspaceId === workspace.id ? proposal.toWorkspace : proposal.fromWorkspace;
  const summary = summarise(terms, sites, priceRules(settings));
  const mine = summary.get(workspace.id) ?? { receives: 0, gives: 0, pays: 0 };
  const theirs = summary.get(other.id) ?? { receives: 0, gives: 0, pays: 0 };
  const footprint = proposal.status === "OPEN" ? await checkFootprint(terms, sites) : { blocks: [], warnings: [] };
  const myTurn = proposal.status === "OPEN" && proposal.awaitingWorkspaceId === workspace.id;
  const canAct = hasRole(membership.role, "MEMBER");

  const approved = (ws: string, role: "canGive" | "canReceive") => allSites.filter((s) => s.workspaceId === ws && s.status === "APPROVED" && s[role]);

  return (
    <>
      <PageHeader title={`${proposal.kind === "SWAP" ? "ABC swap" : "Offer"} with ${other.name}`} description={`Revision ${proposal.revision} · ${proposal.status.toLowerCase()}`} />
      <div className="flex max-w-3xl flex-col gap-4">
        <Flash done={done} />
        {proposal.dealId && (
          <Card title="Accepted">
            <Link href={`/app/deals/${proposal.dealId}`} className="text-sm text-accent">
              Go to the deal
            </Link>
          </Card>
        )}
        <Card title="Links">
          <LegsTable legs={terms.legs} sites={sites} workspaceNames={names} />
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-border p-3">
              <dt className="text-muted">You receive / give (credit value)</dt>
              <dd className="font-semibold tabular-nums">
                {mine.receives} / {mine.gives}
                {mine.pays > 0 && <span className="text-muted"> · you pay {mine.pays} cr</span>}
              </dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-muted">{other.name} receives / gives</dt>
              <dd className="font-semibold tabular-nums">
                {theirs.receives} / {theirs.gives}
                {theirs.pays > 0 && <span className="text-muted"> · they pay {theirs.pays} cr</span>}
              </dd>
            </div>
          </dl>
        </Card>

        <FootprintNotes result={footprint} />

        {proposal.status === "OPEN" && canAct && (
          <Card title={myTurn ? "Your move" : `Waiting for ${other.name}`}>
            {myTurn ? (
              <div className="flex flex-col gap-4">
                <ActionForm action={acceptAction} submit="Accept and start the deal">
                  <input type="hidden" name="proposalId" value={proposal.id} />
                  <input type="hidden" name="revision" value={proposal.revision} />
                  {mine.pays > 0 && (
                    <p className="text-sm text-muted">
                      {mine.pays} credits will be held in escrow (you have {balances.available} available).
                    </p>
                  )}
                </ActionForm>
                <form action={closeProposalAction}>
                  <input type="hidden" name="proposalId" value={proposal.id} />
                  <Button variant="danger">Decline</Button>
                </form>
              </div>
            ) : (
              <form action={closeProposalAction}>
                <input type="hidden" name="proposalId" value={proposal.id} />
                <Button variant="danger">Withdraw</Button>
              </form>
            )}
          </Card>
        )}

        {myTurn && canAct && proposal.kind === "SWAP" && (
          <Card title="Counter-offer" description="Change URLs, anchors, sites or credits. Each link keeps its direction.">
            <ActionForm action={counterAction} submit="Send counter-offer" variant="secondary">
              <input type="hidden" name="proposalId" value={proposal.id} />
              <LegsEditor
                slots={terms.legs.map((l, i) => {
                  const giver = sites.get(l.fromSiteId)!.workspaceId;
                  const receiver = sites.get(l.toSiteId)!.workspaceId;
                  return {
                    title: `${i + 1}. ${names.get(giver)} links to ${names.get(receiver)}`,
                    fromOptions: approved(giver, "canGive"),
                    toOptions: approved(receiver, "canReceive"),
                    value: l,
                    creditsLabel: `${receiver === workspace.id ? "You" : "They"} pay (credits)`,
                  };
                })}
              />
              <textarea name="message" rows={2} maxLength={4000} placeholder="Optional message" aria-label="Message" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
            </ActionForm>
          </Card>
        )}

        <Thread proposalId={proposal.dealId ? undefined : proposal.id} dealId={proposal.dealId ?? undefined} workspaceIds={parties} canPost={canAct && !proposal.dealId && proposal.status === "OPEN"} />
      </div>
    </>
  );
}
