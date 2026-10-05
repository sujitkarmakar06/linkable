import type { CreditBucket, CreditReason, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "./db";

type Side = { workspaceId: string | null; bucket: CreditBucket };

// Moves credits between two ledger accounts as one balanced transaction.
export async function transferCredits(
  tx: Prisma.TransactionClient,
  args: { from: Side; to: Side; amount: number; reason: CreditReason; dealId?: string; note?: string; createdById?: string },
) {
  if (!Number.isInteger(args.amount) || args.amount <= 0) throw new Error("Credit amount must be a positive integer");
  const txId = randomUUID();
  const common = { txId, reason: args.reason, dealId: args.dealId, note: args.note, createdById: args.createdById };
  await tx.creditEntry.createMany({
    data: [
      { ...common, workspaceId: args.from.workspaceId, bucket: args.from.bucket, amount: -args.amount },
      { ...common, workspaceId: args.to.workspaceId, bucket: args.to.bucket, amount: args.amount },
    ],
  });
  return txId;
}

export async function getBalances(workspaceId: string) {
  const rows = await db.creditEntry.groupBy({
    by: ["bucket"],
    where: { workspaceId },
    _sum: { amount: true },
  });
  const sum = (b: CreditBucket) => rows.find((r) => r.bucket === b)?._sum.amount ?? 0;
  return { available: sum("AVAILABLE"), escrow: sum("ESCROW") };
}
