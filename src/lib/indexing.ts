import type { IndexState } from "@prisma/client";

// Escrow waits for Google to index the page carrying the link. If it isn't
// indexed within INDEX_DEADLINE_DAYS of verification, the receiver is refunded.
export const INDEX_DEADLINE_DAYS = 30;
export const INDEX_REMINDER_DAYS_LEFT = 7;
// Each pending page is inspected at most once per this many hours.
export const INDEX_RECHECK_HOURS = 20;

export const indexDeadlineFrom = (verifiedAt: Date) => new Date(verifiedAt.getTime() + INDEX_DEADLINE_DAYS * 86_400_000);

// Escrow releases for a link are allowed in these states.
export const PAYABLE_INDEX_STATES: IndexState[] = ["INDEXED", "EXEMPT"];

export type IndexView = { tone: "success" | "danger" | "muted"; label: string; detail: string };

export function describeIndex(
  leg: { indexState: IndexState; indexDeadline: Date | null; indexedAt: Date | null; indexCheckedAt: Date | null; indexCoverage: string | null },
  hostConnected: boolean,
  now = new Date(),
): IndexView | null {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  switch (leg.indexState) {
    case "NOT_STARTED":
    case "EXEMPT":
      return null;
    case "INDEXED":
      return { tone: "success", label: "Indexed by Google", detail: `Confirmed ${leg.indexedAt ? day(leg.indexedAt) : ""} in the host's Search Console. Escrow is being released.` };
    case "EXPIRED":
      return { tone: "danger", label: "Not indexed", detail: "Google didn't index the page within the deadline, so the escrowed credits went back to the receiver." };
    case "PENDING": {
      const daysLeft = leg.indexDeadline ? Math.max(0, Math.ceil((leg.indexDeadline.getTime() - now.getTime()) / 86_400_000)) : INDEX_DEADLINE_DAYS;
      const why = !hostConnected
        ? "The host hasn't connected Google Search Console for this site, so indexing can't be confirmed yet."
        : leg.indexCoverage
          ? `Google's last answer: "${leg.indexCoverage}"${leg.indexCheckedAt ? ` (${day(leg.indexCheckedAt)})` : ""}.`
          : "First check runs with the next daily job.";
      return { tone: "muted", label: "Waiting for Google to index the page", detail: `${why} Escrow pays out once it's indexed; ${daysLeft} day${daysLeft === 1 ? "" : "s"} left before the credits go back to the receiver.` };
    }
  }
}
