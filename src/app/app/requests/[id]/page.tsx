import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { priceLink } from "@/lib/credits";
import { db } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { getSettings, priceRules } from "@/lib/settings";
import type { Terms } from "@/lib/terms";
import { createOfferAction } from "@/server/actions/proposals";
import { cancelLinkRequestAction } from "@/server/actions/requests";
import { requireMembership } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { RequestStatusBadge } from "@/components/request-status";
import { Button, Card, Field, PageHeader, Select } from "@/components/ui";

export const metadata: Metadata = { title: "Link request" };

export default async function RequestPage({ params }: PageProps<"/app/requests/[id]">) {
  const { id } = await params;
  const { membership, workspace } = await requireMembership();
  const request = await db.linkRequest.findUnique({ where: { id }, include: { site: true, workspace: true } });
  // Others may view open requests (to make offers); owners always can.
  if (!request || (request.workspaceId !== workspace.id && request.status !== "OPEN")) notFound();
  const own = request.workspaceId === workspace.id;
  const settings = await getSettings();
  const niches = request.niches.length ? request.niches : [request.site.niche];

  const offers = own
    ? await db.proposal.findMany({ where: { linkRequestId: request.id }, include: { fromWorkspace: true }, orderBy: { createdAt: "desc" } })
    : [];
  const offerSites = own ? await db.site.findMany({ where: { id: { in: offers.map((o) => (o.terms as Terms).legs[0].fromSiteId) } } }) : [];
  const eligible = !own
    ? await db.site.findMany({ where: { workspaceId: workspace.id, status: "APPROVED", canGive: true, niche: { in: niches }, domainRating: { gte: request.minDomainRating } } })
    : [];
  const rules = priceRules(settings);
  const priceFor = (dr: number | null, traffic: number | null) => priceLink({ domainRating: dr ?? 0, monthlyTraffic: traffic, rel: request.rel, placementType: request.placementType }, rules);

  return (
    <>
      <PageHeader title={`Link to ${request.site.domain}`} description={own ? "Your request" : `Requested by ${request.workspace.name}`}>
        <RequestStatusBadge status={request.status} />
      </PageHeader>
      <div className="flex max-w-3xl flex-col gap-4">
        <Card>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-muted">Target page</dt>
              <dd className="break-all">{request.targetUrl}</dd>
            </div>
            <div>
              <dt className="text-muted">Anchors</dt>
              <dd>{request.anchors.join(" · ")}</dd>
            </div>
            <div>
              <dt className="text-muted">Linking site</dt>
              <dd>
                DR {request.minDomainRating}+ in {niches.join(", ")}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Type</dt>
              <dd>
                {request.placementType === "GUEST_POST" ? "Guest post" : "Link insertion"}, {request.rel.toLowerCase()}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Pays up to</dt>
              <dd>{request.maxCredits} credits</dd>
            </div>
          </dl>
        </Card>

        {own && (
          <Card title="Offers" description="Accepting an offer locks its price in escrow until the link is confirmed live.">
            {offers.length === 0 ? (
              <p className="text-sm text-muted">No offers yet. Your request is listed on the marketplace.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {offers.map((o) => {
                  const leg = (o.terms as Terms).legs[0];
                  const from = offerSites.find((s) => s.id === leg.fromSiteId);
                  return (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
                      <span>
                        <strong>{from?.domain}</strong> (DR {from?.domainRating ?? "-"}) from {o.fromWorkspace.name} · {leg.credits} cr · {o.status.toLowerCase()}
                      </span>
                      <Link href={`/app/proposals/${o.id}`} className="text-accent">
                        Review
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {request.status === "OPEN" && hasRole(membership.role, "MEMBER") && (
              <form action={cancelLinkRequestAction} className="mt-4">
                <input type="hidden" name="requestId" value={request.id} />
                <Button variant="danger">Cancel request</Button>
              </form>
            )}
          </Card>
        )}

        {!own && hasRole(membership.role, "MEMBER") && (
          <Card title="Offer a link and earn credits" description="You place the link; once they confirm it's live, credits are released to you in stages.">
            {eligible.length === 0 ? (
              <p className="text-sm text-muted">
                None of your approved sites match (DR {request.minDomainRating}+, niche {niches.join("/")}, gives links).
              </p>
            ) : (
              <ActionForm action={createOfferAction} submit="Send offer">
                <input type="hidden" name="requestId" value={request.id} />
                <Field label="Your site">
                  <Select name="fromSiteId" required>
                    {eligible.map((s) => {
                      const p = priceFor(s.domainRating, s.organicTraffic);
                      return (
                        <option key={s.id} value={s.id} disabled={p == null || p > request.maxCredits}>
                          {s.domain} · DR {s.domainRating} · {p ?? "-"} cr{p != null && p > request.maxCredits ? " (over budget)" : ""}
                        </option>
                      );
                    })}
                  </Select>
                </Field>
                <Field label="Anchor">
                  <Select name="anchor" required>
                    {request.anchors.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </Select>
                </Field>
              </ActionForm>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
