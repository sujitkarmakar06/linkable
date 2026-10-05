import type { Prisma } from "@prisma/client";

// Reputation 0-100, starting at 50. Every change is audit-logged with its reason.
export const REPUTATION = {
  verifiedOnTime: 2,
  dealCompleted: 3,
  placementOverdue: -5,
  linkRemoved: -15,
  disputeLost: -10,
  reviewPerStarFromThree: 2, // 5 stars = +4, 1 star = -4
} as const;

export async function adjustReputation(tx: Prisma.TransactionClient, workspaceId: string, delta: number, reason: string, actorId?: string | null) {
  if (!delta) return;
  const ws = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { reputation: true } });
  const next = Math.max(0, Math.min(100, ws.reputation + delta));
  await tx.workspace.update({ where: { id: workspaceId }, data: { reputation: next } });
  await tx.auditLog.create({ data: { actorId: actorId ?? null, workspaceId, action: "reputation.changed", meta: { delta, from: ws.reputation, to: next, reason } } });
}
