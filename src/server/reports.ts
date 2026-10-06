import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appUrl, sendEmail } from "@/lib/email";

export function previousMonth(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end, label: start.toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" }), period: start.toISOString().slice(0, 7) };
}

export async function workspaceMonth(workspaceId: string, start: Date, end: Date) {
  const inMonth = { gte: start, lt: end };
  const [received, given, removedAsGiver, earned, spent, active, ws] = await Promise.all([
    db.dealLeg.count({ where: { receiverWorkspaceId: workspaceId, verifiedAt: inMonth } }),
    db.dealLeg.count({ where: { giverWorkspaceId: workspaceId, verifiedAt: inMonth } }),
    db.dealLeg.count({ where: { giverWorkspaceId: workspaceId, removedAt: inMonth } }),
    db.creditEntry.aggregate({ where: { workspaceId, bucket: "AVAILABLE", reason: "ESCROW_RELEASE", createdAt: inMonth }, _sum: { amount: true } }),
    db.creditEntry.aggregate({ where: { workspaceId, bucket: "AVAILABLE", reason: "ESCROW_LOCK", createdAt: inMonth }, _sum: { amount: true } }),
    db.dealLeg.count({ where: { receiverWorkspaceId: workspaceId, status: "VERIFIED" } }),
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true, reputation: true } }),
  ]);
  return { name: ws.name, reputation: ws.reputation, received, given, removedAsGiver, earned: earned._sum.amount ?? 0, spent: -(spent._sum.amount ?? 0), activeLinks: active };
}

// First daily run of each month: one summary email per workspace member who
// wants it. A JobRun row makes the run happen once even if the job repeats.
export async function runMonthlyReports(now = new Date(), { force = false } = {}) {
  // Only in the first days of a month, so a first deploy mid-month doesn't send a stale report.
  if (!force && now.getUTCDate() > 3) return 0;
  const { start, end, label, period } = previousMonth(now);
  try {
    await db.jobRun.create({ data: { kind: "monthly_report", period } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return 0; // already sent
    throw err;
  }
  const workspaces = await db.workspace.findMany({ where: { suspendedAt: null, sites: { some: {} } }, include: { memberships: { include: { user: true } } } });
  let sent = 0;
  for (const w of workspaces) {
    const s = await workspaceMonth(w.id, start, end);
    const items = [
      { title: `${s.received} link${s.received === 1 ? "" : "s"} gained`, body: `Verified links to your sites in ${label}. ${s.activeLinks} live in total.` },
      { title: `${s.given} link${s.given === 1 ? "" : "s"} given`, body: `Links you placed that were verified.${s.removedAsGiver ? ` ${s.removedAsGiver} removed during the guarantee.` : ""}` },
      { title: `Credits: +${s.earned} earned, ${s.spent} spent`, body: "Earned = escrow released to you; spent = credits locked for links you receive." },
      { title: `Reputation ${s.reputation}/100`, body: "Placing on time, keeping links live and good reviews raise it." },
    ];
    for (const m of w.memberships.filter((m) => m.user.monthlyReport && !m.user.suspendedAt)) {
      await sendEmail(m.user.email, `${w.name}: your Linkable report for ${label}`, `${w.name} - ${label}`, "Your month on Linkable:", { label: "Open dashboard", url: appUrl("/app") }, items).catch((err) =>
        console.error("[report]", err),
      );
      sent++;
    }
  }
  return sent;
}
