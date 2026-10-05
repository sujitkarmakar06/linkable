import type { DealStatus, LegStatus } from "@prisma/client";

export const DEAL_LABEL: Record<DealStatus, string> = {
  PROPOSED: "Proposed",
  AGREED: "Agreed - links due",
  IN_PROGRESS: "In progress",
  LIVE: "Live",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  DISPUTED: "Disputed",
};

export const LEG_LABEL: Record<LegStatus, string> = {
  PENDING: "Waiting for placement",
  CONTENT_SUBMITTED: "Content submitted",
  CONTENT_APPROVED: "Content approved",
  PLACED: "Placed - waiting for confirmation",
  VERIFIED: "Live",
  FAILING: "Failing checks - in grace period",
  REMOVED: "Removed",
  CANCELLED: "Cancelled",
};

export function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "success" | "danger" }) {
  const cls = { muted: "border-border text-muted", success: "border-success/40 text-success", danger: "border-danger/40 text-danger" }[tone];
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${cls}`}>{children}</span>;
}
