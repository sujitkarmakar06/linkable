import type { Metadata } from "next";
import Link from "next/link";
import type { SiteStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getSeoProvider } from "@/lib/seo";
import { getSettings } from "@/lib/settings";
import type { SpamSignal } from "@/lib/spam";
import { approveSiteAction, refreshSiteMetricsAction, rejectSiteAction, setSiteMetricsAction, suspendSiteAction } from "@/server/actions/admin-sites";
import { requireAdmin } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { formatNumber, SiteStatusBadge } from "@/components/site-status";
import { Alert, Card, Field, Input, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Site reviews" };

const TABS: { status: SiteStatus; label: string }[] = [
  { status: "PENDING_REVIEW", label: "Waiting for review" },
  { status: "APPROVED", label: "Approved" },
  { status: "REJECTED", label: "Rejected" },
  { status: "SUSPENDED", label: "Suspended" },
  { status: "DRAFT", label: "Not verified" },
];

export default async function AdminSitesPage({ searchParams }: PageProps<"/admin/sites">) {
  await requireAdmin();
  const { status: raw, msg } = await searchParams;
  const status = TABS.find((t) => t.status === raw)?.status ?? "PENDING_REVIEW";
  const [sites, counts, settings] = await Promise.all([
    db.site.findMany({ where: { status }, include: { workspace: true }, orderBy: { updatedAt: "asc" }, take: 50 }),
    db.site.groupBy({ by: ["status"], _count: true }),
    getSettings(),
  ]);
  const provider = getSeoProvider();
  // Sites in other workspaces on the same IP C-class: a footprint hint for reviewers.
  const classes = [...new Set(sites.map((s) => s.ipCClass).filter((c): c is string => Boolean(c)))];
  const neighbours = classes.length
    ? await db.site.findMany({ where: { ipCClass: { in: classes } }, select: { id: true, domain: true, ipCClass: true, workspaceId: true } })
    : [];

  return (
    <>
      <PageHeader title="Site reviews" description={`Metrics provider: ${provider ? provider.name : "none configured - enter DR and traffic by hand"}`} />
      <nav className="mb-5 flex flex-wrap gap-2 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={`/admin/sites?status=${t.status}`}
            className={`rounded-full border px-3 py-1 ${t.status === status ? "border-accent text-accent" : "border-border text-muted"}`}
          >
            {t.label} ({counts.find((c) => c.status === t.status)?._count ?? 0})
          </Link>
        ))}
      </nav>
      {typeof msg === "string" && (
        <div className="mb-4">
          <Alert tone="success">{msg}</Alert>
        </div>
      )}
      {sites.length === 0 && <p className="text-sm text-muted">Nothing here.</p>}
      <div className="flex flex-col gap-4">
        {sites.map((site) => {
          const a = site.spamSignals as { signals?: SpamSignal[]; warnings?: string[] } | null;
          const sameClass = neighbours.filter((n) => n.ipCClass === site.ipCClass && n.id !== site.id && n.workspaceId !== site.workspaceId);
          const belowMin =
            (site.domainRating != null && site.domainRating < settings.minDomainRating) ||
            (site.organicTraffic != null && site.organicTraffic < settings.minMonthlyTraffic);
          return (
            <Card key={site.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <a href={`https://${site.domain}`} target="_blank" rel="noopener noreferrer nofollow" className="text-lg font-semibold text-accent">
                    {site.domain}
                  </a>
                  <div className="text-sm text-muted">
                    {site.workspace.name} · {site.niche} · {[site.canGive && "gives", site.canReceive && "receives"].filter(Boolean).join(" + ")} · verified via{" "}
                    {site.verificationMethod?.replace("_", " ").toLowerCase() ?? "-"}
                  </div>
                </div>
                <SiteStatusBadge status={site.status} />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted">DR</dt>
                  <dd className="font-semibold tabular-nums">{formatNumber(site.domainRating)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Traffic/mo</dt>
                  <dd className="font-semibold tabular-nums">{formatNumber(site.organicTraffic)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Spam score</dt>
                  <dd className="font-semibold tabular-nums">{site.spamScore == null ? "-" : `${site.spamScore}/100`}</dd>
                </div>
                <div>
                  <dt className="text-muted">IP</dt>
                  <dd className="font-mono text-xs">{site.ipAddress ?? "-"}</dd>
                </div>
              </dl>

              {(a?.warnings?.length || a?.signals?.length || sameClass.length || belowMin) && (
                <ul className="mt-3 list-disc pl-5 text-sm text-muted">
                  {belowMin && <li className="text-danger">Below the platform minimums</li>}
                  {a?.warnings?.map((w) => <li key={w}>{w}</li>)}
                  {a?.signals?.map((s) => (
                    <li key={s.code + s.label}>
                      {s.label} <span className="text-xs">(+{s.weight})</span>
                    </li>
                  ))}
                  {sameClass.length > 0 && <li>Same IP C-class as other workspaces&apos; sites: {sameClass.map((n) => n.domain).join(", ")}</li>}
                </ul>
              )}
              {site.reviewNote && <p className="mt-3 text-sm">Note: {site.reviewNote}</p>}

              <div className="mt-5 grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
                <ActionForm action={setSiteMetricsAction} submit="Save metrics" variant="secondary" className="flex flex-col gap-3">
                  <input type="hidden" name="siteId" value={site.id} />
                    <input type="hidden" name="tab" value={status} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="DR">
                      <Input name="domainRating" type="number" min={0} max={100} defaultValue={site.domainRating ?? ""} required />
                    </Field>
                    <Field label="Traffic/mo">
                      <Input name="organicTraffic" type="number" min={0} defaultValue={site.organicTraffic ?? ""} required />
                    </Field>
                  </div>
                </ActionForm>
                <div className="flex flex-col gap-3">
                  {site.status !== "APPROVED" && site.verifiedAt && (
                    <ActionForm action={approveSiteAction} submit="Approve" className="flex flex-col gap-3">
                      <input type="hidden" name="siteId" value={site.id} />
                    <input type="hidden" name="tab" value={status} />
                      <Input name="note" placeholder="Optional note to the owner" aria-label="Approval note" />
                    </ActionForm>
                  )}
                  {site.status !== "REJECTED" && site.status !== "SUSPENDED" && (
                    <ActionForm action={site.status === "APPROVED" ? suspendSiteAction : rejectSiteAction} submit={site.status === "APPROVED" ? "Suspend" : "Reject"} variant="danger" className="flex flex-col gap-3">
                      <input type="hidden" name="siteId" value={site.id} />
                    <input type="hidden" name="tab" value={status} />
                      <Input name="note" placeholder="Reason (the owner sees this)" aria-label="Reason" required />
                    </ActionForm>
                  )}
                  {site.verifiedAt && provider && (
                    <ActionForm action={refreshSiteMetricsAction} submit={`Re-fetch from ${provider.name} (uses API credits)`} variant="secondary">
                      <input type="hidden" name="siteId" value={site.id} />
                    <input type="hidden" name="tab" value={status} />
                    </ActionForm>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
