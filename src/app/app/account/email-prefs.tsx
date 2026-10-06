import type { User } from "@prisma/client";
import { updateEmailPrefsAction } from "@/server/actions/notifications";
import { ActionForm } from "@/components/action-form";
import { Field, Select } from "@/components/ui";

const OPTIONS = [
  ["INSTANT", "Right away"],
  ["DIGEST", "Daily digest"],
  ["OFF", "Off (in-app only)"],
] as const;

export function EmailPrefs({ user }: { user: User }) {
  const pick = (name: "emailDeals" | "emailMessages" | "emailSites", label: string, hint: string) => (
    <Field label={label} hint={hint}>
      <Select name={name} defaultValue={user[name]}>
        {OPTIONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <ActionForm action={updateEmailPrefsAction} submit="Save email settings">
      <div className="grid gap-4 sm:grid-cols-3">
        {pick("emailDeals", "Deals and matches", "Proposals, offers, matches, placements, guest posts")}
        {pick("emailMessages", "Messages", "New messages in deals and proposals")}
        {pick("emailSites", "Site reviews", "Approvals, rejections, suspensions")}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="monthlyReport" defaultChecked={user.monthlyReport} /> Monthly report email
      </label>
      <p className="text-xs text-muted">Failing or removed links, overdue placements, disputes and security emails are always sent right away.</p>
    </ActionForm>
  );
}
