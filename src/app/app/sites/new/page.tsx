import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { createSiteAction } from "@/server/actions/sites";
import { requireMembership } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { SiteFields } from "@/components/site-fields";
import { Card, Field, Input, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Add a site" };

export default async function NewSitePage() {
  await requireMembership("ADMIN");
  const settings = await getSettings();
  return (
    <>
      <PageHeader title="Add a site" description={`Sites need DR ${settings.minDomainRating}+ and ${settings.minMonthlyTraffic.toLocaleString("en")}+ organic visits a month.`} />
      <Card className="max-w-2xl">
        <ActionForm action={createSiteAction} submit="Add site and verify ownership">
          <Field label="Domain" hint="Just the domain, e.g. example.com. Subdomains are listed separately.">
            <Input name="domain" placeholder="example.com" required autoFocus />
          </Field>
          <SiteFields bannedNiches={settings.bannedNiches} />
        </ActionForm>
      </Card>
    </>
  );
}
