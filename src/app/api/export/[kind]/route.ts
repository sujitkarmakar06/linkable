import { db } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { getCurrentMembership, getSessionUser } from "@/server/session";

// Workspace exports: links (deal legs), credit ledger, link-check history.
export async function GET(_req: Request, ctx: RouteContext<"/api/export/[kind]">) {
  const { kind } = await ctx.params;
  const user = await getSessionUser();
  const membership = await getCurrentMembership();
  if (!user || user.suspendedAt || !membership) return new Response("Unauthorized", { status: 401 });
  const ws = membership.workspaceId;
  const stamp = new Date().toISOString().slice(0, 10);
  const mine = { OR: [{ giverWorkspaceId: ws }, { receiverWorkspaceId: ws }] };

  if (kind === "links") {
    const legs = await db.dealLeg.findMany({ where: mine, include: { fromSite: true, toSite: true, deal: true }, orderBy: { createdAt: "desc" }, take: 10_000 });
    return csvResponse(
      toCsv(legs, [
        ["deal_id", (l) => l.dealId],
        ["direction", (l) => (l.giverWorkspaceId === ws ? "given" : "received")],
        ["from_site", (l) => l.fromSite.domain],
        ["to_site", (l) => l.toSite.domain],
        ["target_url", (l) => l.targetUrl],
        ["anchor", (l) => l.anchor],
        ["rel", (l) => l.rel],
        ["type", (l) => l.placementType],
        ["source_page", (l) => l.sourcePageUrl],
        ["link_status", (l) => l.status],
        ["deal_status", (l) => l.deal.status],
        ["credits", (l) => l.credits],
        ["created_at", (l) => l.createdAt],
        ["placed_at", (l) => l.placedAt],
        ["verified_at", (l) => l.verifiedAt],
        ["guarantee_ends", (l) => l.deal.guaranteeEnds],
      ]),
      `linkable-links-${stamp}.csv`,
    );
  }
  if (kind === "ledger") {
    const rows = await db.creditEntry.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" }, take: 50_000 });
    return csvResponse(
      toCsv(rows, [
        ["date", (r) => r.createdAt],
        ["reason", (r) => r.reason],
        ["balance", (r) => r.bucket],
        ["amount", (r) => r.amount],
        ["deal_id", (r) => r.dealId],
        ["note", (r) => r.note],
      ]),
      `linkable-credits-${stamp}.csv`,
    );
  }
  if (kind === "checks") {
    const rows = await db.linkCheck.findMany({ where: { leg: mine }, include: { leg: { include: { fromSite: true, toSite: true } } }, orderBy: { checkedAt: "desc" }, take: 50_000 });
    return csvResponse(
      toCsv(rows, [
        ["checked_at", (r) => r.checkedAt],
        ["from_site", (r) => r.leg.fromSite.domain],
        ["to_site", (r) => r.leg.toSite.domain],
        ["page", (r) => r.leg.sourcePageUrl],
        ["http_status", (r) => r.httpStatus],
        ["link_found", (r) => r.linkFound],
        ["anchor_match", (r) => r.anchorMatch],
        ["rel", (r) => r.rel],
        ["noindex", (r) => r.noindex],
        ["problem", (r) => r.error],
      ]),
      `linkable-link-checks-${stamp}.csv`,
    );
  }
  return new Response("Not found", { status: 404 });
}
