import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getBalances } from "@/lib/ledger";
import { getSettings } from "@/lib/settings";
import { ROLE_LABEL } from "@/lib/roles";
import { requireMembership } from "@/server/session";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Dashboard" };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default async function DashboardPage() {
  const { user, membership, workspace } = await requireMembership();
  const [settings, balances, sites, openRequests, members] = await Promise.all([
    getSettings(),
    getBalances(workspace.id),
    db.site.count({ where: { workspaceId: workspace.id } }),
    db.linkRequest.count({ where: { workspaceId: workspace.id, status: "OPEN" } }),
    db.membership.count({ where: { workspaceId: workspace.id } }),
  ]);

  const steps = [
    { done: true, label: "Create your workspace" },
    { done: user.twoFactorEnabled, label: "Turn on two-factor authentication", href: "/app/account" },
    { done: members > 1, label: "Invite your team (optional)", href: "/app/workspace" },
    { done: sites > 0, label: `Add and verify your first site (DR ${settings.minDomainRating}+) - coming next` },
  ];

  return (
    <>
      <PageHeader title={workspace.name} description={`You're ${ROLE_LABEL[membership.role].toLowerCase()} of this workspace · Free plan`} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Available credits" value={String(balances.available)} hint={`${settings.starterCredits} starter credits after your first site is approved`} />
        <Stat label="In escrow" value={String(balances.escrow)} hint="Locked in running deals" />
        <Stat label="Sites" value={`${sites} / ${settings.freeMaxSites}`} hint="Free plan limit" />
        <Stat label="Open link requests" value={`${openRequests} / ${settings.freeMaxOpenRequests}`} hint="Free plan limit" />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Getting started">
          <ul className="flex flex-col gap-2 text-sm">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-2">
                <span aria-hidden className={s.done ? "text-success" : "text-muted"}>
                  {s.done ? "●" : "○"}
                </span>
                {s.href && !s.done ? (
                  <Link href={s.href} className="text-accent">
                    {s.label}
                  </Link>
                ) : (
                  <span className={s.done ? "text-muted line-through" : ""}>{s.label}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="How ABC exchange works on Linkable">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-muted">
            <li>List a site that can give links (your &quot;C&quot; site) and earn credits when you place a link on it.</li>
            <li>Spend credits to get a link to your money site (&quot;A&quot;) from someone else&apos;s site (&quot;B&quot;).</li>
            <li>Nobody links straight back, so there&apos;s no reciprocal footprint. Every link is checked weekly and guaranteed for {settings.guaranteeMonths} months.</li>
          </ol>
        </Card>
      </div>
    </>
  );
}
