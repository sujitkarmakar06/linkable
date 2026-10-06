import type { SiteStatus } from "@prisma/client";

const STYLE: Record<SiteStatus, [string, string]> = {
  DRAFT: ["Not verified", "border-border text-muted"],
  PENDING_REVIEW: ["In review", "border-amber-500/40 text-amber-600 dark:text-amber-400"],
  APPROVED: ["Approved", "border-success/40 text-success"],
  REJECTED: ["Rejected", "border-danger/40 text-danger"],
  SUSPENDED: ["Suspended", "border-danger/40 text-danger"],
};

export function SiteStatusBadge({ status }: { status: SiteStatus }) {
  const [label, cls] = STYLE[status];
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${cls}`}>{label}</span>;
}

export const formatNumber = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("en"));
