import type { ImpactWindow } from "@prisma/client";

// Link impact compares 28-day windows of the linked-to page's Google search
// numbers: the 28 days before the link went live, and the 28 days ending 30,
// 60 and 90 days after. Search Console data lags about 3 days.
export const WINDOW_DAYS = 28;
export const GSC_LAG_DAYS = 3;
export const IMPACT_WINDOWS: { window: ImpactWindow; label: string; endOffset: number }[] = [
  { window: "BASELINE", label: "Before the link", endOffset: -1 },
  { window: "D30", label: "30 days after", endOffset: 30 },
  { window: "D60", label: "60 days after", endOffset: 60 },
  { window: "D90", label: "90 days after", endOffset: 90 },
];

const DAY = 86_400_000;
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function impactWindows(liveAt: Date) {
  const base = utcDay(liveAt);
  return IMPACT_WINDOWS.map((w) => {
    const end = new Date(base.getTime() + w.endOffset * DAY);
    return { ...w, start: new Date(end.getTime() - (WINDOW_DAYS - 1) * DAY), end };
  });
}

// Windows whose data Search Console has finished reporting.
export function dueWindows(liveAt: Date, now = new Date()) {
  const ready = utcDay(now).getTime() - GSC_LAG_DAYS * DAY;
  return impactWindows(liveAt).filter((w) => w.end.getTime() <= ready);
}

export type Totals = { clicks: number; impressions: number; position: number | null };

// Percentage change against the baseline; null when there's no baseline to compare.
export function pctChange(before: number, after: number): number | null {
  if (before === 0) return after === 0 ? 0 : null;
  return Math.round(((after - before) / before) * 100);
}

export function formatChange(before: number, after: number): string {
  const pct = pctChange(before, after);
  if (pct === null) return after > 0 ? "new" : "-";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

// Lower position is better, so an improvement is a negative number of places.
export function positionChange(before: number | null, after: number | null): string {
  if (before === null || after === null) return "-";
  const diff = Math.round((before - after) * 10) / 10;
  if (diff === 0) return "same";
  return diff > 0 ? `up ${diff}` : `down ${-diff}`;
}
