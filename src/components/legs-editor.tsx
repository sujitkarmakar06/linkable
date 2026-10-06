import type { Site } from "@prisma/client";
import type { LegTerm } from "@/lib/terms";
import { Field, Input, Select } from "./ui";

export type LegSlot = {
  title: string;
  hint?: string;
  fromOptions: Site[];
  toOptions: Site[];
  value?: Partial<LegTerm>;
  creditsLabel: string;
};

const siteLabel = (s: Site) => `${s.domain} · DR ${s.domainRating ?? "-"} · ${s.niche}`;

// Form fields for the links in a proposal, named legs.<i>.<field>.
export function LegsEditor({ slots }: { slots: LegSlot[] }) {
  return (
    <>
      <input type="hidden" name="legCount" value={slots.length} />
      {slots.map((slot, i) => (
        <fieldset key={i} className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold">{slot.title}</legend>
          {slot.hint && <p className="-mt-1 text-xs text-muted">{slot.hint}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Link placed on">
              <Select name={`legs.${i}.fromSiteId`} defaultValue={slot.value?.fromSiteId ?? slot.fromOptions[0]?.id} required>
                {slot.fromOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {siteLabel(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Linking to">
              <Select name={`legs.${i}.toSiteId`} defaultValue={slot.value?.toSiteId ?? slot.toOptions[0]?.id} required>
                {slot.toOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {siteLabel(s)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Target page URL" hint="The page that receives the link.">
            <Input name={`legs.${i}.targetUrl`} type="url" defaultValue={slot.value?.targetUrl ?? ""} placeholder="https://" required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
            <Field label="Anchor text">
              <Input name={`legs.${i}.anchor`} defaultValue={slot.value?.anchor ?? ""} maxLength={100} required />
            </Field>
            <Field label="Type">
              <Select name={`legs.${i}.placementType`} defaultValue={slot.value?.placementType ?? "INSERTION"}>
                <option value="INSERTION">Link insertion</option>
                <option value="GUEST_POST">Guest post</option>
              </Select>
            </Field>
            <Field label="Rel">
              <Select name={`legs.${i}.rel`} defaultValue={slot.value?.rel ?? "DOFOLLOW"}>
                <option value="DOFOLLOW">Dofollow</option>
                <option value="NOFOLLOW">Nofollow</option>
              </Select>
            </Field>
            <Field label={slot.creditsLabel}>
              <Input name={`legs.${i}.credits`} type="number" min={0} max={1000} defaultValue={slot.value?.credits ?? 0} />
            </Field>
          </div>
        </fieldset>
      ))}
    </>
  );
}
