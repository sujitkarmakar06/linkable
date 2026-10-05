import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { priceLink } from "@/lib/credits";
import { hasRole } from "@/lib/roles";
import { getSettings, priceRules } from "@/lib/settings";
import { createSwapAction } from "@/server/actions/proposals";
import { requireMembership } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { LegsEditor } from "@/components/legs-editor";
import { formatNumber } from "@/components/site-status";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Partner site" };

export default async function PartnerSitePage({ params }: PageProps<"/app/marketplace/[siteId]">) {
  const { siteId } = await params;
  const { membership, workspace } = await requireMembership();
  const site = await db.site.findFirst({ where: { id: siteId, status: "APPROVED", workspaceId: { not: workspace.id } }, include: { workspace: true } });
  if (!site) notFound();
  const [mine, theirs, settings] = await Promise.all([
    db.site.findMany({ where: { workspaceId: workspace.id, status: "APPROVED" }, orderBy: { domain: "asc" } }),
    db.site.findMany({ where: { workspaceId: site.workspaceId, status: "APPROVED" }, orderBy: { domain: "asc" } }),
    getSettings(),
  ]);
  const price = priceLink({ domainRating: site.domainRating ?? 0, monthlyTraffic: site.organicTraffic, rel: "DOFOLLOW", placementType: "INSERTION" }, priceRules(settings));
  const myReceivers = mine.filter((s) => s.canReceive);
  const myGivers = mine.filter((s) => s.canGive);
  const theirReceivers = theirs.filter((s) => s.canReceive);
  // A real ABC swap needs a link back that doesn't come from the site they link to.
  const abcPossible = site.canGive && myReceivers.length > 0 && myGivers.length > 0 && theirReceivers.length > 0 && (mine.length > 1 || theirReceivers.length > 1);

  return (
    <>
      <PageHeader title={site.domain} description={`${site.niche} · listed by ${site.workspace.name} · reputation ${site.workspace.reputation}/100`} />
      <div className="flex max-w-3xl flex-col gap-4">
        <Card>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted">DR</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatNumber(site.domainRating)}</dd>
            </div>
            <div>
              <dt className="text-muted">Traffic/mo</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatNumber(site.organicTraffic)}</dd>
            </div>
            <div>
              <dt className="text-muted">Link value</dt>
              <dd className="text-lg font-semibold tabular-nums">{price ?? "-"} cr</dd>
            </div>
            <div>
              <dt className="text-muted">Uses</dt>
              <dd>{[site.canGive && "Gives", site.canReceive && "Receives"].filter(Boolean).join(" · ")}</dd>
            </div>
          </dl>
        </Card>

        {!hasRole(membership.role, "MEMBER") ? null : !site.canGive ? (
          <Card title="This site doesn't give links" description="It only receives links, so you can't get a link from it." />
        ) : !abcPossible ? (
          <Card title="Propose an ABC swap" description="An ABC swap needs a link back that doesn't come from the site that links to you.">
            <p className="text-sm text-muted">
              You need an approved site that receives links and one that gives links, and either two sites of your own or a partner with a second site.
              With one site you can still trade with credits: post a{" "}
              <Link href="/app/requests/new" className="text-accent">
                link request
              </Link>{" "}
              or earn credits on the{" "}
              <Link href="/app/marketplace?tab=requests" className="text-accent">
                open requests
              </Link>
              .
            </p>
          </Card>
        ) : (
          <Card title="Propose an ABC swap" description={`${site.domain} links to your site; you link back from a different site, so neither pair links to each other.`}>
            <ActionForm action={createSwapAction} submit="Send proposal">
              <input type="hidden" name="partnerWorkspaceId" value={site.workspaceId} />
              <LegsEditor
                slots={[
                  { title: `1. ${site.workspace.name} links to you`, fromOptions: [site], toOptions: myReceivers, creditsLabel: "You pay (credits)", value: { fromSiteId: site.id } },
                  {
                    title: `2. You link to ${site.workspace.name}`,
                    hint: "Give from a different site than the one receiving link 1, or link to a different site of theirs.",
                    fromOptions: [...myGivers].sort((a, b) => Number(myReceivers[0]?.id === a.id) - Number(myReceivers[0]?.id === b.id)),
                    toOptions: theirReceivers,
                    creditsLabel: "They pay (credits)",
                  },
                ]}
              />
              <textarea name="message" rows={3} maxLength={4000} placeholder="Optional message" aria-label="Message" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
