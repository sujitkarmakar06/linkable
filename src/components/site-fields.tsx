import type { Site } from "@prisma/client";
import { NICHES } from "@/lib/niches";
import { Field, Input, Select } from "./ui";

// Shared by "add site" and "edit site". Banned niches are filtered out.
export function SiteFields({ site, bannedNiches }: { site?: Site; bannedNiches: string[] }) {
  const banned = new Set(bannedNiches.map((n) => n.toLowerCase()));
  return (
    <>
      <Field label="Niche" hint="Used to match you with relevant sites.">
        <Select name="niche" defaultValue={site?.niche ?? ""} required>
          <option value="" disabled>
            Choose a niche
          </option>
          {NICHES.filter((n) => !banned.has(n.toLowerCase())).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">How will you use this site?</legend>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="canGive" defaultChecked={site?.canGive ?? true} className="mt-0.5" />
          <span>
            <span className="font-medium">Give links</span> <span className="text-muted">- place links on it to earn credits (a &quot;C&quot; site)</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="canReceive" defaultChecked={site?.canReceive ?? true} className="mt-0.5" />
          <span>
            <span className="font-medium">Receive links</span> <span className="text-muted">- spend credits to get links to it (an &quot;A&quot; site)</span>
          </span>
        </label>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Max links given per month" hint="Keeps outbound links natural.">
          <Input name="maxOutboundPerMonth" type="number" min={1} max={20} defaultValue={site?.maxOutboundPerMonth ?? 4} required />
        </Field>
        <Field label="Main audience country (optional)">
          <Input name="country" defaultValue={site?.country ?? ""} placeholder="e.g. United States" maxLength={56} />
        </Field>
      </div>
    </>
  );
}
