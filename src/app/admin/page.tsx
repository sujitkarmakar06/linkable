import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { updateSettingsAction } from "@/server/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const [settings, users, workspaces, sitesPending] = await Promise.all([
    getSettings(),
    db.user.count(),
    db.workspace.count(),
    db.site.count({ where: { status: "PENDING_REVIEW" } }),
  ]);

  const num = (name: keyof typeof settings, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input name={name} type="number" min={0} defaultValue={String(settings[name])} required />
    </Field>
  );

  return (
    <>
      <PageHeader title="Admin" description="Platform rules and health. Site moderation, disputes and analytics arrive with their phases." />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          ["Users", users],
          ["Workspaces", workspaces],
          ["Sites waiting for review", sitesPending],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-surface p-4">
            <div className="text-sm text-muted">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      <Card title="Marketplace rules" description="Changes apply immediately, no deploy needed." className="max-w-3xl">
        <ActionForm action={updateSettingsAction} submit="Save rules">
          <div className="grid gap-4 sm:grid-cols-2">
            {num("minDomainRating", "Minimum DR to list a site")}
            {num("minMonthlyTraffic", "Minimum monthly organic traffic")}
            {num("starterCredits", "Starter credits", "Granted when a workspace's first site is approved")}
            {num("freeMaxSites", "Free plan: max sites")}
            {num("freeMaxOpenRequests", "Free plan: max open link requests")}
            {num("guaranteeMonths", "Link guarantee (months)")}
            {num("checkIntervalDays", "Link check interval (days)")}
            {num("graceDays", "Grace period to restore a removed link (days)")}
            {num("removalPenaltyCredits", "Penalty for early removal (credits)")}
            {num("pairCooldownMonths", "Months before the same two workspaces can trade again")}
          </div>
          <Field label="Banned niches" hint="Comma-separated.">
            <Input name="bannedNiches" defaultValue={settings.bannedNiches.join(", ")} />
          </Field>
          <div className="text-sm">
            <div className="mb-2 font-medium">Credit price by DR</div>
            <ul className="grid grid-cols-2 gap-2 text-muted sm:grid-cols-4">
              {settings.creditTiers.map((t) => (
                <li key={t.minDr} className="rounded-md border border-border px-3 py-2">
                  DR {t.minDr}-{t.maxDr}: <span className="text-text">{t.credits}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              Nofollow links cost {settings.nofollowMultiplier}x. Guest posts cost +{settings.guestPostBonus}. Under 1k traffic costs 0.75x, 50k+ costs 1.25x.
            </p>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
