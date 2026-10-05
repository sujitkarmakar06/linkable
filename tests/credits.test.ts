import { describe, expect, it } from "vitest";
import { DEFAULT_CREDIT_TIERS, priceLink, releaseStages } from "@/lib/credits";

const rules = { tiers: DEFAULT_CREDIT_TIERS, nofollowMultiplier: 0.25, guestPostBonus: 1 };
const base = { rel: "DOFOLLOW", placementType: "INSERTION", monthlyTraffic: 5_000 } as const;

describe("priceLink", () => {
  it("prices by DR tier", () => {
    expect(priceLink({ ...base, domainRating: 30 }, rules)).toBe(1);
    expect(priceLink({ ...base, domainRating: 45 }, rules)).toBe(2);
    expect(priceLink({ ...base, domainRating: 79 }, rules)).toBe(4);
    expect(priceLink({ ...base, domainRating: 92 }, rules)).toBe(8);
  });

  it("refuses sites below the minimum DR", () => {
    expect(priceLink({ ...base, domainRating: 29 }, rules)).toBeNull();
  });

  it("adjusts for traffic, nofollow and guest posts", () => {
    expect(priceLink({ ...base, domainRating: 65, monthlyTraffic: 200 }, rules)).toBe(3); // 4 * 0.75
    expect(priceLink({ ...base, domainRating: 65, monthlyTraffic: 80_000 }, rules)).toBe(5); // 4 * 1.25
    expect(priceLink({ ...base, domainRating: 85, rel: "NOFOLLOW" }, rules)).toBe(2); // 8 * 0.25
    expect(priceLink({ ...base, domainRating: 45, placementType: "GUEST_POST" }, rules)).toBe(3);
  });

  it("never prices a tradable link at zero", () => {
    expect(priceLink({ ...base, domainRating: 30, rel: "NOFOLLOW" }, rules)).toBe(1);
  });
});

describe("releaseStages", () => {
  it("releases ~40/20/20/20, holds back small amounts and always sums to the total", () => {
    const start = new Date("2026-01-15T00:00:00Z");
    for (const total of [1, 2, 3, 7, 8, 10, 13]) {
      const stages = releaseStages(total, start);
      expect(stages.reduce((s, x) => s + x.amount, 0)).toBe(total);
    }
    expect(releaseStages(1, start).map((s) => [s.afterMonths, s.amount])).toEqual([[3, 1]]);
    expect(releaseStages(2, start).map((s) => [s.afterMonths, s.amount])).toEqual([[0, 1], [6, 1]]);
    expect(releaseStages(4, start).map((s) => s.amount)).toEqual([2, 1, 1]);
    const stages = releaseStages(10, start);
    expect(stages.map((s) => s.amount)).toEqual([4, 2, 2, 2]);
    expect(stages.map((s) => s.releaseAt.toISOString().slice(0, 10))).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2027-01-15"]);
  });
});
