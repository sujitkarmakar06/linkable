import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { gscEnabled } from "@/lib/gsc";
import { hasRole } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import type { SpamSignal } from "@/lib/spam";
import { dnsRecordValue, htmlFileContent, htmlFilePath, metaTagHtml } from "@/lib/verification";
import { deleteSiteAction, updateSiteAction, verifySiteAction } from "@/server/actions/sites";
import { requireMembership } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { SiteFields } from "@/components/site-fields";
import { formatNumber, SiteStatusBadge } from "@/components/site-status";
import { Alert, Button, Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Site" };

const GSC_MESSAGES: Record<string, ["success" | "error", string]> = {
  ok: ["success", "Verified through Google Search Console."],
  not_owner: ["error", "That Google account isn't an owner or full user of this domain in Search Console."],
  taken: ["error", "This domain is already verified by another workspace."],
  cancelled: ["error", "Google sign-in was cancelled."],
  error: ["error", "Search Console check failed. Try again or use another method."],
};

function Code({ children }: { children: string }) {
  return <code className="block overflow-x-auto rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap">{children}</code>;
}

function VerifyMethod({ siteId, method, title, open, children }: { siteId: string; method: string; title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="rounded-lg border border-border p-4 [&_summary]:cursor-pointer">
      <summary className="font-medium">{title}</summary>
      <div className="mt-3 flex flex-col gap-3 text-sm">
        {children}
        <ActionForm action={verifySiteAction} submit="Check now">
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="method" value={method} />
        </ActionForm>
      </div>
    </details>
  );
}

export default async function SitePage({ params, searchParams }: PageProps<"/app/sites/[id]">) {
  const { id } = await params;
  const { gsc } = await searchParams;
  const { membership, workspace } = await requireMembership();
  const site = await db.site.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!site) notFound();
  const settings = await getSettings();
  const canManage = hasRole(membership.role, "ADMIN");
  const assessment = site.spamSignals as { signals?: SpamSignal[]; warnings?: string[] } | null;
  const gscMessage = typeof gsc === "string" ? GSC_MESSAGES[gsc] : undefined;
  const token = site.verificationToken;

  return (
    <>
      <PageHeader title={site.domain} description={`${site.niche}${site.country ? ` · ${site.country}` : ""}`}>
        <SiteStatusBadge status={site.status} />
      </PageHeader>
      <div className="flex max-w-3xl flex-col gap-4">
        {gscMessage && <Alert tone={gscMessage[0]}>{gscMessage[1]}</Alert>}
        {site.status === "PENDING_REVIEW" && <Alert tone="success">Ownership verified. An admin is reviewing the site; you&apos;ll get an email with the decision.</Alert>}
        {site.status === "APPROVED" && <Alert tone="success">Approved and listed. Matching and deals arrive in the next phases.</Alert>}
        {(site.status === "REJECTED" || site.status === "SUSPENDED") && (
          <Alert tone="error">
            {site.status === "REJECTED" ? "Not approved." : "Suspended."} {site.reviewNote}
          </Alert>
        )}

        {!site.verifiedAt && (
          <Card title="1. Prove you own this site" description="Use any one method. You only need to do this once.">
            {!canManage ? (
              <p className="text-sm text-muted">A workspace admin needs to verify this site.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {site.lastVerifyError && <Alert tone="error">Last check: {site.lastVerifyError}</Alert>}
                <VerifyMethod siteId={site.id} method="DNS_TXT" title="DNS TXT record (recommended)" open>
                  <p>
                    In your domain&apos;s DNS settings, add a <strong>TXT</strong> record on <strong>{site.domain}</strong> (host <code>@</code>) with this value:
                  </p>
                  <Code>{dnsRecordValue(token)}</Code>
                  <p className="text-muted">DNS changes can take a few minutes to an hour to show up.</p>
                </VerifyMethod>
                <VerifyMethod siteId={site.id} method="META_TAG" title="HTML meta tag">
                  <p>
                    Add this tag inside the <code>&lt;head&gt;</code> of your homepage (https://{site.domain}/):
                  </p>
                  <Code>{metaTagHtml(token)}</Code>
                </VerifyMethod>
                <VerifyMethod siteId={site.id} method="HTML_FILE" title="Upload an HTML file">
                  <p>Create a file at this address:</p>
                  <Code>{`https://${site.domain}${htmlFilePath(token)}`}</Code>
                  <p>containing exactly:</p>
                  <Code>{htmlFileContent(token)}</Code>
                </VerifyMethod>
                <details className="rounded-lg border border-border p-4 [&_summary]:cursor-pointer">
                  <summary className="font-medium">Google Search Console</summary>
                  <div className="mt-3 flex flex-col gap-3 text-sm">
                    {gscEnabled() ? (
                      <>
                        <p>Sign in with a Google account that is an owner or full user of {site.domain} in Search Console. We only read your list of properties, once.</p>
                        <div>
                          <a href={`/api/gsc/start?siteId=${site.id}`} className="inline-flex rounded-md border border-border px-3.5 py-2 font-medium">
                            Verify with Google
                          </a>
                        </div>
                      </>
                    ) : (
                      <p className="text-muted">Not available yet: the platform&apos;s Google keys aren&apos;t configured.</p>
                    )}
                  </div>
                </details>
              </div>
            )}
          </Card>
        )}

        <Card title={site.verifiedAt ? "Metrics" : "2. Metrics and review"} description={site.verifiedAt ? undefined : "After verification we fetch DR and traffic, scan for spam signals, and an admin reviews the site."}>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted">Domain Rating</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatNumber(site.domainRating)}</dd>
            </div>
            <div>
              <dt className="text-muted">Organic traffic/mo</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatNumber(site.organicTraffic)}</dd>
            </div>
            <div>
              <dt className="text-muted">Verified via</dt>
              <dd>{site.verificationMethod?.replace("_", " ").toLowerCase() ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-muted">Metrics source</dt>
              <dd>{site.metricsProvider ?? "-"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            Minimums: DR {settings.minDomainRating}, {settings.minMonthlyTraffic.toLocaleString("en")} visits/month.
          </p>
          {assessment?.signals && assessment.signals.length > 0 && (
            <div className="mt-4 text-sm">
              <div className="font-medium">Quality signals</div>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {assessment.signals.map((s) => (
                  <li key={s.code + s.label}>{s.label}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {canManage && (
          <Card title="Settings">
            <ActionForm action={updateSiteAction} submit="Save">
              <input type="hidden" name="siteId" value={site.id} />
              <SiteFields site={site} bannedNiches={settings.bannedNiches} />
            </ActionForm>
          </Card>
        )}

        {canManage && (
          <Card title="Remove site" description="Removes the site from Linkable. Sites used in a deal can't be removed.">
            <form action={deleteSiteAction}>
              <input type="hidden" name="siteId" value={site.id} />
              <Button variant="danger">Remove {site.domain}</Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
