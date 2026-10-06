import { describe, expect, it } from "vitest";
import { dueWindows, formatChange, impactWindows, isoDay, pctChange, positionChange } from "@/lib/impact";
import { describeIndex, indexDeadlineFrom } from "@/lib/indexing";

describe("impact windows", () => {
  const live = new Date("2026-03-15T17:30:00Z");

  it("uses 28-day windows before and 30/60/90 days after the link", () => {
    const w = impactWindows(live).map((x) => [x.window, isoDay(x.start), isoDay(x.end)]);
    expect(w).toEqual([
      ["BASELINE", "2026-02-15", "2026-03-14"],
      ["D30", "2026-03-18", "2026-04-14"],
      ["D60", "2026-04-17", "2026-05-14"],
      ["D90", "2026-05-17", "2026-06-13"],
    ]);
  });

  it("waits for Search Console's reporting lag", () => {
    expect(dueWindows(live, new Date("2026-03-16T00:00:00Z")).map((w) => w.window)).toEqual([]);
    expect(dueWindows(live, new Date("2026-03-17T00:00:00Z")).map((w) => w.window)).toEqual(["BASELINE"]);
    expect(dueWindows(live, new Date("2026-04-17T08:00:00Z")).map((w) => w.window)).toEqual(["BASELINE", "D30"]);
    expect(dueWindows(live, new Date("2026-09-01T00:00:00Z"))).toHaveLength(4);
  });
});

describe("change formatting", () => {
  it("handles a zero baseline", () => {
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(0, 5)).toBeNull();
    expect(formatChange(0, 5)).toBe("new");
    expect(formatChange(10, 15)).toBe("+50%");
    expect(formatChange(10, 5)).toBe("-50%");
  });

  it("treats a lower position as an improvement", () => {
    expect(positionChange(12.4, 8.1)).toBe("up 4.3");
    expect(positionChange(8, 9.5)).toBe("down 1.5");
    expect(positionChange(8, 8)).toBe("same");
    expect(positionChange(null, 8)).toBe("-");
  });
});

describe("describeIndex", () => {
  const verified = new Date("2026-03-01T00:00:00Z");
  const leg = { indexState: "PENDING" as const, indexDeadline: indexDeadlineFrom(verified), indexedAt: null, indexCheckedAt: null, indexCoverage: null };

  it("sets the deadline 30 days after verification", () => {
    expect(isoDay(indexDeadlineFrom(verified))).toBe("2026-03-31");
  });

  it("explains why a pending link is waiting", () => {
    expect(describeIndex(leg, false, new Date("2026-03-21T00:00:00Z"))?.detail).toMatch(/hasn't connected Google Search Console.*10 days left/);
    const checked = { ...leg, indexCoverage: "Crawled - currently not indexed", indexCheckedAt: new Date("2026-03-20T00:00:00Z") };
    expect(describeIndex(checked, true, new Date("2026-03-30T12:00:00Z"))?.detail).toMatch(/Crawled - currently not indexed.*1 day left/);
  });

  it("shows nothing before verification or for older links", () => {
    expect(describeIndex({ ...leg, indexState: "NOT_STARTED" }, true)).toBeNull();
    expect(describeIndex({ ...leg, indexState: "EXEMPT" }, true)).toBeNull();
    expect(describeIndex({ ...leg, indexState: "EXPIRED" }, true)?.tone).toBe("danger");
  });
});
