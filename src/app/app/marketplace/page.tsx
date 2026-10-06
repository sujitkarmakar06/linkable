import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { priceLink } from "@/lib/credits";
import { db } from "@/lib/db";
import { NICHES } from "@/lib/niches";
import { getSettings, priceRules } from "@/lib/settings";
import { requireMembership } from "@/server/session";
import { formatNumber } from "@/components/site-status";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";

export const metadata: Metadata = { title: "Marketplace" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function MarketplacePage({ searchParams }: PageProps<"/app/marketplace">) {
  const { workspace } = await requireMembership();
  const sp = await searchParams;
  const tab = one(sp.tab) === "requests" ? "requests" : "sites";
  const niche = NICHES.includes(one(sp.niche) as never) ? one(sp.niche) : "";
  const minDr = Math.max(0, Math.min(100, Number(one(sp.minDr)) || 0));
  const q = one(sp.q).trim().toLowerCase().slice(0, 60);
  const settings = await getSettings();
  const rules = priceRules(settings);

  const siteWhere: Prisma.SiteWhereInput = {
    status: "APPROVED",
    workspaceId: { not: workspace.id },
    workspace: { suspendedAt: null },
    ...(niche ? { niche } : {}),
    ...(minDr ? { domainRating: { gte: minDr } } : {}),
    ...(q ? { domain: { contains: q } } : {}),
  };
  const [sites, requests] = await Promise.all([
    tab === "sites" ? db.site.findMany({ where: siteWhere, include: { workspace: true }, orderBy: [{ domainRating: "desc" }], take: 60 }) : [],
    tab === "requests"
      ? db.linkRequest.findMany({
          where: { status: "OPEN", workspaceId: { not: workspace.id }, workspace: { suspendedAt: null }, ...(niche ? { OR: [{ niches: { has: niche } }, { niches: { isEmpty: true }, site: { niche } }] } : {}), ...(q ? { site: { domain: { contains: q } } } : {}) },
          include: { site: true, workspace: true },
          orderBy: { createdAt: "desc" },
          take: 60,
        })
      : [],
  ]);

  return (
    <>
      <PageHeader title="Marketplace" description="Approved sites from other workspaces, and open requests you can earn credits on." />
      <nav className="mb-4 flex gap-2 text-sm">
        {(["sites", "requests"] as const).map((t) => (
          <Link key={t} href={`/app/marketplace?tab=${t}`} className={`rounded-full border px-3 py-1 ${t === tab ? "border-accent text-accent" : "border-border text-muted"}`}>
            {t === "sites" ? "Sites" : "Open link requests"}
          </Link>
        ))}
      </nav>
      <form className="mb-5 grid gap-3 sm:grid-cols-[2fr_1.5fr_1fr_auto] sm:items-end">
        <input type="hidden" name="tab" value={tab} />
        <Field label="Search domain">
          <Input name="q" defaultValue={q} placeholder="example" />
        </Field>
        <Field label="Niche">
          <Select name="niche" defaultValue={niche}>
            <option value="">Any niche</option>
            {NICHES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </Select>
        </Field>
        {tab === "sites" ? (
          <Field label="Min DR">
            <Input name="minDr" type="number" min={0} max={100} defaultValue={minDr || ""} />
          </Field>
        ) : (
          <div />
        )}
        <Button variant="secondary">Filter</Button>
      </form>

      {tab === "sites" &&
        (sites.length === 0 ? (
          <Card title="No sites match" description="Try another niche, or check back as more sites are approved." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sites.map((s) => {
              const price = priceLink({ domainRating: s.domainRating ?? 0, monthlyTraffic: s.organicTraffic, rel: "DOFOLLOW", placementType: "INSERTION" }, rules);
              return (
                <Link key={s.id} href={`/app/marketplace/${s.id}`} className="rounded-xl border border-border bg-surface p-4 hover:border-accent">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold">{s.domain}</div>
                    <div className="text-sm tabular-nums">DR {formatNumber(s.domainRating)}</div>
                  </div>
                  <div className="mt-1 text-sm text-muted">
                    {s.niche} · {formatNumber(s.organicTraffic)} visits/mo
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                    {s.canGive && <span className="rounded-full border border-border px-2 py-0.5">Gives links{price ? ` · ${price} cr` : ""}</span>}
                    {s.canReceive && <span className="rounded-full border border-border px-2 py-0.5">Receives links</span>}
                    <span className="rounded-full border border-border px-2 py-0.5">Reputation {s.workspace.reputation}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ))}

      {tab === "requests" &&
        (requests.length === 0 ? (
          <Card title="No open requests" description="When other workspaces ask for links, they show up here." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  {["Link to", "Niche", "Wants", "Min DR", "Pays up to"].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <Link href={`/app/requests/${r.id}`} className="font-medium text-accent">
                        {r.site.domain}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{(r.niches.length ? r.niches : [r.site.niche]).join(", ")}</td>
                    <td className="px-4 py-3 text-muted">
                      {r.placementType === "GUEST_POST" ? "Guest post" : "Insertion"} · {r.rel.toLowerCase()}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{r.minDomainRating}</td>
                    <td className="px-4 py-3 tabular-nums">{r.maxCredits} cr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </>
  );
}
