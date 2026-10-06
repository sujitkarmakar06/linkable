import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getBalances } from "@/lib/ledger";
import { NICHES } from "@/lib/niches";
import { getSettings } from "@/lib/settings";
import { createLinkRequestAction } from "@/server/actions/requests";
import { aiEnabled } from "@/server/ai";
import { AnchorSuggester } from "@/components/ai-widgets";
import { requireMembership } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, PageHeader, Select } from "@/components/ui";

export const metadata: Metadata = { title: "New link request" };

export default async function NewRequestPage() {
  const { workspace } = await requireMembership("MEMBER");
  const [sites, settings, balances] = await Promise.all([
    db.site.findMany({ where: { workspaceId: workspace.id, status: "APPROVED", canReceive: true } }),
    getSettings(),
    getBalances(workspace.id),
  ]);
  const banned = new Set(settings.bannedNiches.map((n) => n.toLowerCase()));
  return (
    <>
      <PageHeader title="New link request" description={`You have ${balances.available} credits available. Credits are only taken when you accept an offer.`} />
      {sites.length === 0 ? (
        <Card title="You need an approved site first" description="Requests are for links to your own approved sites.">
          <Link href="/app/sites" className="text-sm text-accent">
            Go to My sites
          </Link>
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <ActionForm id="new-request" action={createLinkRequestAction} submit="Post request">
            <Field label="Site to receive the link">
              <Select name="siteId" required>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.domain}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Target page URL">
              <Input name="targetUrl" type="url" placeholder="https://" required />
            </Field>
            <Field label="Anchor texts" hint="One per line, up to 5. The giver picks one.">
              <textarea name="anchors" rows={3} required className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
            </Field>
            {aiEnabled() && <AnchorSuggester formId="new-request" />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type">
                <Select name="placementType" defaultValue="INSERTION">
                  <option value="INSERTION">Link insertion</option>
                  <option value="GUEST_POST">Guest post</option>
                </Select>
              </Field>
              <Field label="Rel">
                <Select name="rel" defaultValue="DOFOLLOW">
                  <option value="DOFOLLOW">Dofollow</option>
                  <option value="NOFOLLOW">Nofollow</option>
                </Select>
              </Field>
              <Field label="Minimum DR of the linking site">
                <Input name="minDomainRating" type="number" min={settings.minDomainRating} max={100} defaultValue={settings.minDomainRating} required />
              </Field>
              <Field label="Most you'll pay (credits)" hint="DR 30-39 = 1, 40-59 = 2, 60-79 = 4, 80+ = 8.">
                <Input name="maxCredits" type="number" min={1} max={100} defaultValue={2} required />
              </Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="autoMatch" defaultChecked className="mt-0.5" />
              <span>
                <span className="font-medium">Match automatically</span>{" "}
                <span className="text-muted">- Linkable offers this request to the best-fitting sites. When one accepts, the price is held in escrow without another approval from you.</span>
              </span>
            </label>
            <Field label="Acceptable niches for the linking site" hint="Leave empty to require the same niche as your site. Hold Ctrl/Cmd to pick several.">
              <Select name="niches" multiple size={6} className="w-full">
                {NICHES.filter((n) => !banned.has(n.toLowerCase())).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
