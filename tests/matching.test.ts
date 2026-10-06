import { describe, expect, it } from "vitest";
import { pickTop, scoreCandidate, type Candidate } from "@/lib/matching";

const base: Candidate = { niche: "Technology", domainRating: 55, organicTraffic: 10_000, reputation: 50, linksThisMonth: 0, maxOutboundPerMonth: 4 };

describe("scoreCandidate", () => {
  it("stays within 0-100 and rewards fit and quality", () => {
    const top = scoreCandidate({ ...base, domainRating: 90, organicTraffic: 500_000, reputation: 100, relevance: 100 }, { siteNiche: "Technology" });
    expect(top).toBe(100);
    const weak = scoreCandidate({ ...base, niche: "Business", domainRating: 30, organicTraffic: 1, reputation: 0, linksThisMonth: 4, relevance: 0 }, { siteNiche: "Technology" });
    expect(weak).toBe(15);
    expect(scoreCandidate(base, { siteNiche: "Technology" })).toBeGreaterThan(scoreCandidate({ ...base, niche: "Business" }, { siteNiche: "Technology" }));
  });

  it("ranks topically relevant sites higher, neutral when unknown", () => {
    const at = (relevance: number | null) => scoreCandidate({ ...base, relevance }, { siteNiche: "Technology" });
    expect(at(90)).toBeGreaterThan(at(null));
    expect(at(null)).toBeGreaterThan(at(10));
    expect(at(null)).toBe(at(50));
  });

  it("prefers sites with spare monthly capacity", () => {
    expect(scoreCandidate(base, { siteNiche: "Technology" })).toBeGreaterThan(scoreCandidate({ ...base, linksThisMonth: 3 }, { siteNiche: "Technology" }));
  });
});

describe("pickTop", () => {
  it("keeps one site per workspace and the highest scores", () => {
    const picked = pickTop(
      [
        { id: "a1", workspaceId: "A", score: 70 },
        { id: "a2", workspaceId: "A", score: 90 },
        { id: "b1", workspaceId: "B", score: 60 },
        { id: "c1", workspaceId: "C", score: 80 },
        { id: "d1", workspaceId: "D", score: 10 },
      ],
      3,
    );
    expect(picked.map((p) => p.id)).toEqual(["a2", "c1", "b1"]);
  });
});
