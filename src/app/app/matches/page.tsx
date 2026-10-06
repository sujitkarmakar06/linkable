import type { Metadata } from "next";
import { db } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { acceptMatchAction, declineMatchAction } from "@/server/actions/matches";
import { MATCH_TTL_HOURS } from "@/server/matching";
import { requireMembership } from "@/server/session";
import { ActionForm } from "@/components/action-form";
import { Button, Card, Field, PageHeader, Select } from "@/components/ui";
import { relevanceLabel } from "@/lib/topics";

export const metadata: Metadata = { title: "Matches" };

const hoursLeft = (d: Date) => Math.max(0, Math.round((d.getTime() - Date.now()) / 3_600_000));

export default async function MatchesPage() {
  const { membership, workspace } = await requireMembership();
  const matches = await db.match.findMany({
    where: { workspaceId: workspace.id },
    include: { site: true, linkRequest: { include: { site: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const now = new Date();
  const open = matches.filter((m) => m.status === "OFFERED" && m.expiresAt > now && m.linkRequest.status === "OPEN");
  const past = matches.filter((m) => !open.includes(m));
  const canAct = hasRole(membership.role, "MEMBER");

  return (
    <>
      <PageHeader
        title="Matches"
        description={`Linkable matches your giving sites with requests they fit. Accept to place the link and earn credits. Offers stay open ${MATCH_TTL_HOURS} hours and go to up to 3 sites - the first to accept gets it.`}
      />
      <div className="flex max-w-3xl flex-col gap-4">
        {open.length === 0 && <Card title="No open matches" description="When a request fits one of your approved sites that gives links, it appears here and you get an email." />}
        {open.map((m) => {
          const r = m.linkRequest;
          const warnings = (m.footprint as { warnings?: string[] } | null)?.warnings ?? [];
          return (
            <Card key={m.id}>
              <div id={m.id} className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">
                    {m.site.domain} → {r.site.domain}
                  </div>
                  <div className="text-sm text-muted">
                    {r.site.niche} · {r.placementType === "GUEST_POST" ? "guest post" : "link insertion"} · {r.rel.toLowerCase()} · {hoursLeft(m.expiresAt)}h left
                  </div>
                  {m.relevance != null && (
                    <div className="mt-1 text-sm" title="How closely your site's topics match the page you'd link to">
                      Topic fit: <strong>{relevanceLabel(m.relevance)}</strong> <span className="text-muted">({m.relevance}/100)</span>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-2xl font-semibold tabular-nums">+{m.credits}</div>
                  <div className="text-xs text-muted">credits, paid in stages once Google indexes the page</div>
                </div>
              </div>
              <p className="mt-3 break-all text-sm">
                <span className="text-muted">Link to: </span>
                {r.targetUrl}
              </p>
              {warnings.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-muted">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {canAct && (
                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
                  <ActionForm action={acceptMatchAction} submit="Accept and place the link" className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="matchId" value={m.id} />
                    <Field label="Anchor">
                      <Select name="anchor">
                        {r.anchors.map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </Select>
                    </Field>
                  </ActionForm>
                  <form action={declineMatchAction}>
                    <input type="hidden" name="matchId" value={m.id} />
                    <Button variant="ghost">Not interested</Button>
                  </form>
                </div>
              )}
            </Card>
          );
        })}
        {past.length > 0 && (
          <Card title="Earlier matches">
            <ul className="flex flex-col gap-1 text-sm text-muted">
              {past.map((m) => (
                <li key={m.id}>
                  {m.site.domain} → {m.linkRequest.site.domain} · {m.credits} cr ·{" "}
                  {m.status === "OFFERED" ? (m.linkRequest.status === "OPEN" ? "expired" : "taken") : m.status.toLowerCase()}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
