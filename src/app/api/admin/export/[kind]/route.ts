import { db } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { getSessionUser } from "@/server/session";

export async function GET(_req: Request, ctx: RouteContext<"/api/admin/export/[kind]">) {
  const { kind } = await ctx.params;
  const user = await getSessionUser();
  if (!user || user.suspendedAt || user.platformRole !== "ADMIN") return new Response("Forbidden", { status: 403 });
  const stamp = new Date().toISOString().slice(0, 10);
  await db.auditLog.create({ data: { actorId: user.id, action: "admin.export", target: kind } });

  if (kind === "users") {
    const rows = await db.user.findMany({ include: { memberships: { include: { workspace: true } } }, orderBy: { createdAt: "asc" } });
    return csvResponse(
      toCsv(rows, [
        ["id", (u) => u.id],
        ["name", (u) => u.name],
        ["email", (u) => u.email],
        ["email_verified", (u) => u.emailVerified],
        ["role", (u) => u.platformRole],
        ["two_factor", (u) => u.twoFactorEnabled],
        ["suspended_at", (u) => u.suspendedAt],
        ["workspaces", (u) => u.memberships.map((m) => `${m.workspace.name} (${m.role})`).join("; ")],
        ["created_at", (u) => u.createdAt],
      ]),
      `linkable-users-${stamp}.csv`,
    );
  }
  if (kind === "workspaces") {
    const rows = await db.workspace.findMany({ include: { _count: { select: { memberships: true, sites: true } } }, orderBy: { createdAt: "asc" } });
    const balances = await db.creditEntry.groupBy({ by: ["workspaceId", "bucket"], _sum: { amount: true } });
    const bal = (id: string, b: string) => balances.find((x) => x.workspaceId === id && x.bucket === b)?._sum.amount ?? 0;
    return csvResponse(
      toCsv(rows, [
        ["id", (w) => w.id],
        ["name", (w) => w.name],
        ["plan", (w) => w.plan],
        ["reputation", (w) => w.reputation],
        ["members", (w) => w._count.memberships],
        ["sites", (w) => w._count.sites],
        ["credits_available", (w) => bal(w.id, "AVAILABLE")],
        ["credits_escrow", (w) => bal(w.id, "ESCROW")],
        ["suspended_at", (w) => w.suspendedAt],
        ["created_at", (w) => w.createdAt],
      ]),
      `linkable-workspaces-${stamp}.csv`,
    );
  }
  if (kind === "deals") {
    const rows = await db.dealLeg.findMany({ include: { fromSite: true, toSite: true, deal: true }, orderBy: { createdAt: "desc" }, take: 100_000 });
    return csvResponse(
      toCsv(rows, [
        ["deal_id", (l) => l.dealId],
        ["source", (l) => l.deal.source],
        ["deal_status", (l) => l.deal.status],
        ["from_site", (l) => l.fromSite.domain],
        ["to_site", (l) => l.toSite.domain],
        ["anchor", (l) => l.anchor],
        ["type", (l) => l.placementType],
        ["link_status", (l) => l.status],
        ["credits", (l) => l.credits],
        ["created_at", (l) => l.createdAt],
        ["verified_at", (l) => l.verifiedAt],
        ["removed_at", (l) => l.removedAt],
      ]),
      `linkable-deals-${stamp}.csv`,
    );
  }
  if (kind === "disputes") {
    const rows = await db.dispute.findMany({ include: { openedBy: true, against: true }, orderBy: { createdAt: "desc" } });
    return csvResponse(
      toCsv(rows, [
        ["id", (d) => d.id],
        ["deal_id", (d) => d.dealId],
        ["opened_by", (d) => d.openedBy.name],
        ["against", (d) => d.against.name],
        ["reason", (d) => d.reason],
        ["status", (d) => d.status],
        ["resolution", (d) => d.resolution],
        ["created_at", (d) => d.createdAt],
        ["resolved_at", (d) => d.resolvedAt],
      ]),
      `linkable-disputes-${stamp}.csv`,
    );
  }
  return new Response("Not found", { status: 404 });
}
