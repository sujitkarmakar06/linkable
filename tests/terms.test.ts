import { describe, expect, it } from "vitest";
import { DEFAULT_CREDIT_TIERS } from "@/lib/credits";
import { summarise, urlOnDomain, validateTerms, type LegTerm, type TermsSite } from "@/lib/terms";

const site = (id: string, workspaceId: string, extra: Partial<TermsSite> = {}): TermsSite => ({
  id, workspaceId, domain: `${id}.com`, status: "APPROVED", canGive: true, canReceive: true, domainRating: 45, organicTraffic: 5000, ...extra,
});
// X owns A and C, Y owns B.
const sites = new Map([site("a", "X"), site("c", "X"), site("b", "Y"), site("z", "Z")].map((s) => [s.id, s]));
const leg = (from: string, to: string, extra: Partial<LegTerm> = {}): LegTerm => ({
  fromSiteId: from, toSiteId: to, targetUrl: `https://${to}.com/page`, anchor: "great tools", rel: "DOFOLLOW", placementType: "INSERTION", credits: 0, ...extra,
});
const XY: [string, string] = ["X", "Y"];

describe("validateTerms", () => {
  it("accepts a proper ABC swap: B -> A, C -> B", () => {
    expect(validateTerms("SWAP", { legs: [leg("b", "a"), leg("c", "b")] }, sites, XY)).toEqual([]);
  });

  it("rejects a reciprocal A <-> B swap", () => {
    const errors = validateTerms("SWAP", { legs: [leg("b", "a"), leg("a", "b")] }, sites, XY);
    expect(errors.join(" ")).toMatch(/reciprocal/);
  });

  it("requires both sides to give in a swap", () => {
    expect(validateTerms("SWAP", { legs: [leg("b", "a"), leg("b", "c")] }, sites, XY).join(" ")).toMatch(/both sides/);
  });

  it("enforces site status, roles, parties and URLs", () => {
    const s2 = new Map(sites);
    s2.set("a", site("a", "X", { status: "PENDING_REVIEW" }));
    s2.set("b", site("b", "Y", { canGive: false }));
    const errors = validateTerms("SWAP", { legs: [leg("b", "a", { targetUrl: "https://evil.com/" }), leg("c", "z")] }, s2, XY).join(" | ");
    expect(errors).toMatch(/b.com isn't an approved site that gives/);
    expect(errors).toMatch(/a.com isn't an approved site that receives/);
    expect(errors).toMatch(/must be a page on a.com/);
    expect(errors).toMatch(/belong to the two workspaces/);
  });

  it("blocks self links and offers with more than one link", () => {
    expect(validateTerms("REQUEST_OFFER", { legs: [leg("c", "a")] }, sites, XY).join(" ")).toMatch(/own site/);
    expect(validateTerms("REQUEST_OFFER", { legs: [leg("b", "a"), leg("b", "c")] }, sites, XY).join(" ")).toMatch(/exactly one/);
    expect(validateTerms("REQUEST_OFFER", { legs: [leg("b", "a", { credits: 2 })] }, sites, XY)).toEqual([]);
  });
});

describe("urlOnDomain", () => {
  it("accepts the domain, www and subdomains only", () => {
    expect(urlOnDomain("https://www.a.com/x", "a.com")).toBe(true);
    expect(urlOnDomain("https://blog.a.com/x", "a.com")).toBe(true);
    expect(urlOnDomain("https://a.com.evil.net/", "a.com")).toBe(false);
    expect(urlOnDomain("https://nota.com/", "a.com")).toBe(false);
    expect(urlOnDomain("javascript:alert(1)", "a.com")).toBe(false);
  });
});

describe("summarise", () => {
  it("totals value received/given and credits paid per workspace", () => {
    const rules = { tiers: DEFAULT_CREDIT_TIERS, nofollowMultiplier: 0.25, guestPostBonus: 1 };
    const s = summarise({ legs: [leg("b", "a"), leg("c", "b", { credits: 1 })] }, sites, rules);
    expect(s.get("X")).toEqual({ receives: 2, gives: 2, pays: 0 });
    expect(s.get("Y")).toEqual({ receives: 2, gives: 2, pays: 1 });
  });
});
