import type { LinkRequestStatus } from "@prisma/client";

const LABEL: Record<LinkRequestStatus, string> = { OPEN: "Open", MATCHED: "In a deal", FULFILLED: "Fulfilled", CANCELLED: "Cancelled" };

export function RequestStatusBadge({ status }: { status: LinkRequestStatus }) {
  return <span className="whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs text-muted">{LABEL[status]}</span>;
}
