import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { cancelDealAction, confirmLegAction, placeLegAction } from "@/server/actions/deals";
import { openDisputeAction, submitReviewAction } from "@/server/actions/trust";
import { requireMembership } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { DEAL_LABEL, LEG_LABEL, Pill } from "@/components/deal-status";
import { Flash } from "@/components/flash";
import { FootprintNotes } from "@/components/footprint-notes";
import { Thread } from "@/components/thread";
import { PlacementSuggester } from "@/components/ai-widgets";
import { GuestPostEditor, GuestPostReview } from "@/components/guest-post";
import { countWords, safeMarkdownSource } from "@/lib/guestpost";
import { getSettings } from "@/lib/settings";
import { aiEnabled, aiUsageThisMonth } from "@/server/ai";
import { marked } from "marked";
import { Alert, Card, Field, Input, PageHeader, Select } from "@/components/ui";

export const metadata: Metadata = { title: "Deal" };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

export default async function DealPage({ params, searchParams }: PageProps<"/app/deals/[id]">) {
  const { id } = await params;
  const { done } = await searchParams;
  const { membership, workspace } = await requireMembership();
  const deal = await db.deal.findFirst({
    where: { id, participants: { some: { workspaceId: workspace.id } } },
    include: {
      legs: { include: { fromSite: true, toSite: true, guestPost: true, checks: { orderBy: { checkedAt: "desc" }, take: 5 } }, orderBy: { createdAt: "asc" } },
      participants: { include: { workspace: true } },
      disputes: { orderBy: { createdAt: "desc" } },
      reviews: true,
    },
  });
  if (!deal) notFound();
  const openDispute = deal.disputes.find((d) => d.status === "OPEN");
  const myReview = deal.reviews.find((r) => r.authorWorkspaceId === workspace.id);
  const canDispute = !["CANCELLED", "COMPLETED", "DISPUTED"].includes(deal.status);
  const names = new Map(deal.participants.map((p) => [p.workspaceId, p.workspace.name]));
  const canAct = hasRole(membership.role, "MEMBER");
  const [settings, aiUsed] = await Promise.all([getSettings(), aiUsageThisMonth(workspace.id)]);
  const ai = aiEnabled();
  const open = !["CANCELLED", "COMPLETED", "DISPUTED"].includes(deal.status);
  const cancellable = !["CANCELLED", "COMPLETED"].includes(deal.status) && deal.legs.every((l) => !["PLACED", "VERIFIED"].includes(l.status));

  return (
    <>
      <PageHeader title={`Deal with ${deal.participants.filter((p) => p.workspaceId !== workspace.id).map((p) => p.workspace.name).join(", ")}`} description={`Agreed ${day(deal.createdAt)}${deal.guaranteeEnds ? ` · guaranteed until ${day(deal.guaranteeEnds)}` : ""}`}>
        <Pill tone={deal.status === "LIVE" ? "success" : deal.status === "CANCELLED" ? "danger" : "muted"}>{DEAL_LABEL[deal.status]}</Pill>
      </PageHeader>
      <div className="flex max-w-3xl flex-col gap-4">
        <Flash done={done} />
        {openDispute && (
          <Alert tone="error">
            Disputed by {names.get(openDispute.openedByWorkspaceId)}: {openDispute.reason} An admin is reviewing it; link checks and escrow releases are paused.
          </Alert>
        )}
        {deal.disputes
          .filter((d) => d.status !== "OPEN")
          .map((d) => (
            <Alert key={d.id} tone="success">
              Dispute {d.status === "RESOLVED" ? "resolved" : "closed"}: {d.resolution}
            </Alert>
          ))}
        <FootprintNotes title="Footprint warnings" result={{ blocks: [], warnings: (deal.footprint as { warnings?: string[] } | null)?.warnings ?? [] }} />
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
              {leg.placementType === "GUEST_POST" && (
                <div className="mt-4 border-t border-border pt-4">
                  <div className="mb-2 text-sm font-medium">Guest post</div>
                  {receiving && leg.status === "PENDING" && open && canAct ? (
                    <GuestPostEditor
                      legId={leg.id}
                      anchor={leg.anchor}
                      targetUrl={leg.targetUrl}
                      minWords={settings.guestPostMinWords}
                      aiEnabled={ai}
                      aiDraftsLeft={Math.max(0, settings.aiDraftsPerMonth - aiUsed.drafts)}
                      initial={leg.guestPost ? { title: leg.guestPost.title, body: leg.guestPost.body, hostNote: leg.guestPost.hostNote, revision: leg.guestPost.revision } : null}
                    />
                  ) : giving && leg.status === "PENDING" ? (
                    <p className="text-sm text-muted">
                      Waiting for {names.get(leg.receiverWorkspaceId)} to {leg.guestPost ? "revise the post" : "submit the post"}.
                      {leg.guestPost?.hostNote && ` Your note: ${leg.guestPost.hostNote}`}
                    </p>
                  ) : receiving && leg.status === "CONTENT_SUBMITTED" ? (
                    <p className="text-sm text-muted">Submitted &quot;{leg.guestPost?.title}&quot; (revision {leg.guestPost?.revision}). Waiting for {names.get(leg.giverWorkspaceId)} to review it.</p>
                  ) : leg.guestPost ? (
                    <div className="flex flex-col gap-3">
                      <div className="text-sm">
                        <strong>{leg.guestPost.title}</strong>{" "}
                        <span className="text-muted">
                          · {countWords(leg.guestPost.body)} words · revision {leg.guestPost.revision}
                          {leg.guestPost.aiDrafted && " · AI-assisted"} · {leg.guestPost.status.replace("_", " ")}
                        </span>
                      </div>
                      {giving && ["CONTENT_APPROVED", "PLACED", "VERIFIED", "FAILING"].includes(leg.status) ? (
                        <div className="grid gap-3 lg:grid-cols-2">
                          <Field label="Markdown (copy into your CMS)">
                            <textarea readOnly rows={8} defaultValue={`# ${leg.guestPost.title}

${leg.guestPost.body}`} className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs" />
                          </Field>
                          <Field label="HTML">
                            <textarea readOnly rows={8} defaultValue={marked.parse(safeMarkdownSource(leg.guestPost.body), { async: false })} className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs" />
                          </Field>
                        </div>
                      ) : (
                        <pre className="max-h-96 overflow-auto rounded-md border border-border bg-bg p-3 text-sm whitespace-pre-wrap">{leg.guestPost.body}</pre>
                      )}
                      {giving && leg.status === "CONTENT_SUBMITTED" && canAct && (
                        <GuestPostReview
                          legId={leg.id}
                          canRequestChanges={leg.guestPost.revision <= settings.guestPostMaxRevisions}
                          canReject={leg.guestPost.revision > settings.guestPostMaxRevisions}
                        />
                      )}
                    </div>
                  ) : null}
                </div>
              )}
              {canAct && giving && ai && leg.placementType === "INSERTION" && leg.status === "PENDING" && open && (
                <div className="mt-4 border-t border-border pt-4">
                  <PlacementSuggester legId={leg.id} />
                  <p className="mt-1 text-xs text-muted">{Math.max(0, settings.aiSuggestionsPerMonth - aiUsed.suggestions)} AI suggestions left this month.</p>
                </div>
              )}
              {canAct && giving && (leg.placementType === "GUEST_POST" ? ["CONTENT_APPROVED", "PLACED"] : ["PENDING", "PLACED"]).includes(leg.status) && deal.status !== "CANCELLED" && (
                <div className="mt-4 border-t border-border pt-4">
                  <ActionForm action={placeLegAction} submit={leg.status === "PLACED" ? "Update page URL" : "Mark as placed"}>
                    <input type="hidden" name="legId" value={leg.id} />
                    <Field label={`Page on ${leg.fromSite.domain} where the link is`}>
                      <Input name="sourcePageUrl" type="url" defaultValue={leg.sourcePageUrl ?? ""} placeholder={`https://${leg.fromSite.domain}/...`} required />
                    </Field>
                  </ActionForm>
                </div>
              )}
              {leg.checks.length > 0 && (
                <div className="mt-4 border-t border-border pt-3 text-sm">
                  <div className="mb-1 font-medium">Recent checks</div>
                  <ul className="flex flex-col gap-1 text-muted">
                    {leg.checks.map((c) => (
                      <li key={c.id}>
                        {c.checkedAt.toISOString().slice(0, 16).replace("T", " ")} UTC ·{" "}
                        {c.error ? <span className="text-danger">{c.error}</span> : <span className="text-success">link found{c.anchorMatch === false ? " (different anchor)" : ""}</span>}
                      </li>
                    ))}
                  </ul>
                  {leg.status === "FAILING" && leg.failingSince && <p className="mt-1 text-danger">Failing since {day(leg.failingSince)}. Restore the link before the grace period ends to avoid a penalty.</p>}
                </div>
              )}
              {canAct && receiving && leg.status === "PLACED" && (
                <div className="mt-4 border-t border-border pt-4">
                  <ActionForm action={confirmLegAction} submit="Confirm manually" variant="secondary">
                    <input type="hidden" name="legId" value={leg.id} />
                    <p className="text-sm text-muted">Our crawler checks placed links automatically. If it can&apos;t reach the page (for example, bot protection) and you can see the link, confirm it here.</p>
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

        {canAct && ["LIVE", "COMPLETED"].includes(deal.status) && !myReview && (
          <Card title="Review your partner" description="Ratings feed into their reputation score.">
            <ActionForm action={submitReviewAction} submit="Submit review" variant="secondary">
              <input type="hidden" name="dealId" value={deal.id} />
              <Field label="Rating">
                <Select name="rating" defaultValue="5">
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {"★".repeat(n)} ({n})
                    </option>
                  ))}
                </Select>
              </Field>
              <textarea name="comment" rows={2} maxLength={1000} placeholder="Optional comment" aria-label="Comment" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
            </ActionForm>
          </Card>
        )}

        {myReview && (
          <Card title="Your review">
            <p className="text-sm">
              You rated {names.get(myReview.subjectWorkspaceId)} {"★".repeat(myReview.rating)} ({myReview.rating}/5){myReview.comment ? `: "${myReview.comment}"` : "."}
            </p>
          </Card>
        )}

        {canAct && canDispute && deal.legs.some((l) => l.status !== "PENDING" || (l.dueAt && l.dueAt < new Date())) && (
          <Card title="Something wrong?" description="Open a dispute and an admin will decide. Link checks and escrow releases pause until then.">
            <ActionForm action={openDisputeAction} submit="Open a dispute" variant="danger">
              <input type="hidden" name="dealId" value={deal.id} />
              <Field label="Which link">
                <Select name="legId">
                  <option value="">The whole deal</option>
                  {deal.legs.map((l, i) => (
                    <option key={l.id} value={l.id}>
                      {i + 1}. {l.fromSite.domain} → {l.toSite.domain}
                    </option>
                  ))}
                </Select>
              </Field>
              <textarea name="reason" rows={3} minLength={10} maxLength={4000} required placeholder="What happened?" aria-label="Reason" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
            </ActionForm>
          </Card>
        )}

        <Thread dealId={deal.id} workspaceIds={deal.participants.map((p) => p.workspaceId)} canPost={canAct} />
      </div>
    </>
  );
}
