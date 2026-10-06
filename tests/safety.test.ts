import { describe, expect, it } from "vitest";
import { brandTokens, classifyAnchor } from "@/lib/anchors";
import { evaluateFootprint, type FootprintHistory, type FootprintSite } from "@/lib/footprint";
import { buildProfile, isVelocitySpike, type ProfileLink } from "@/lib/profile";
import { asTopics, extractTopics, relevanceLabel, relevanceScore, tokenize, withKeywords } from "@/lib/topics";

describe("topics", () => {
  it("drops stop words and site furniture, and stems plurals", () => {
    expect(tokenize("The Best Pricing Tools for Agencies - Home | Privacy Policy")).toEqual(["the", "best", "pricing", "tool", "for", "agency", "home", "privacy", "policy"]);
    const t = extractTopics([{ text: "Home About Contact Privacy Policy Cookies", weight: 3 }]);
    expect(t).toEqual([]);
  });

  it("weights titles over body text and keeps repeated phrases", () => {
    const t = extractTopics([
      { text: "Invoice software for freelancers", weight: 3 },
      { text: "invoice software helps freelancers send an invoice. invoice software saves time.", weight: 1 },
    ]);
    expect(t[0].w).toBe(1);
    expect(t.map((x) => x.t)).toContain("invoice software");
    expect(t.map((x) => x.t)).toContain("freelancer");
  });

  it("scores related pages higher than unrelated ones", () => {
    const seo = extractTopics([{ text: "SEO link building guide: backlinks, anchor text and link building outreach for SEO", weight: 1 }]);
    const seo2 = extractTopics([{ text: "Backlinks and link building outreach templates for SEO teams", weight: 1 }]);
    const food = extractTopics([{ text: "Vegan dinner recipes: lentil curry, chickpea stew and easy vegan desserts", weight: 1 }]);
    const related = relevanceScore(seo, seo2)!;
    const unrelated = relevanceScore(seo, food)!;
    expect(related).toBeGreaterThan(60);
    expect(unrelated).toBeLessThan(10);
    expect(relevanceLabel(related)).not.toBe("Low");
    expect(relevanceScore(seo, [])).toBeNull();
    expect(relevanceScore(null, seo)).toBeNull();
  });

  it("merges AI keywords and reads stored JSON safely", () => {
    const t = withKeywords([{ t: "invoice", w: 1 }], ["Time Tracking", "the"]);
    expect(t.map((x) => x.t)).toEqual(["invoice", "time tracking"]);
    expect(asTopics([{ t: "a", w: 1 }, { bad: true }])).toEqual([{ t: "a", w: 1 }]);
    expect(asTopics("nope")).toBeNull();
  });
});

describe("anchors", () => {
  it("derives brand tokens from the domain plus brand names", () => {
    expect(brandTokens("acme-tools.co.uk", ["Acme"])).toEqual(["acme-tools", "acme tools", "acmetools", "acme"]);
  });

  it("classifies anchor types", () => {
    const c = (a: string) => classifyAnchor(a, "acme-tools.com", ["Acme"]);
    expect(c("acme-tools.com")).toBe("url");
    expect(c("https://acme-tools.com/pricing")).toBe("url");
    expect(c("www.example.org")).toBe("url");
    expect(c("Acme Tools")).toBe("branded");
    expect(c("acme pricing")).toBe("branded");
    expect(c("Click here")).toBe("generic");
    expect(c("this guide")).toBe("generic");
    expect(c("project pricing software")).toBe("keyword");
    expect(c("academic tools")).toBe("keyword"); // "acme" only as a whole word
  });
});

describe("link profile", () => {
  const now = new Date("2026-06-15T00:00:00Z");
  const link = (anchor: string, month: string, extra: Partial<ProfileLink> = {}): ProfileLink => ({
    anchor,
    rel: "DOFOLLOW",
    status: "VERIFIED",
    createdAt: new Date(`${month}-10T00:00:00Z`),
    verifiedAt: new Date(`${month}-12T00:00:00Z`),
    ...extra,
  });
  const site = { domain: "acme.com", brandTerms: [] };

  it("suggests a branded anchor first", () => {
    expect(buildProfile([], site, now).suggestion).toMatch(/branded anchor, such as "acme"/);
  });

  it("warns on keyword-heavy profiles, one dominant anchor, and spikes", () => {
    const links = [
      ...Array.from({ length: 5 }, () => link("pricing software", "2026-06")),
      link("acme", "2026-05"),
      link("old link", "2026-01", { status: "REMOVED" }),
    ];
    const p = buildProfile(links, site, now);
    expect(p.total).toBe(6);
    expect(p.byKind).toEqual({ branded: 1, url: 0, generic: 0, keyword: 5 });
    expect(p.months.map((m) => m.n)).toEqual([0, 0, 0, 0, 1, 5]);
    expect(p.warnings.join(" ")).toMatch(/83% of anchors are keyword anchors/);
    expect(p.warnings.join(" ")).toMatch(/"pricing software" is 83%/);
    expect(p.warnings.join(" ")).toMatch(/5 links this month/);
    expect(p.nextKind).not.toBe("keyword");
  });

  it("flags an all-dofollow profile only with enough links", () => {
    const eight = Array.from({ length: 8 }, (_, i) => link(i % 2 ? "acme" : "acme.com", "2026-0" + ((i % 5) + 1)));
    expect(buildProfile(eight, site, now).warnings).toContain("Every link is dofollow. A few nofollow links make a profile look more natural.");
    expect(buildProfile(eight.slice(0, 7), site, now).warnings).toEqual([]);
  });

  it("detects velocity spikes relative to the usual pace", () => {
    expect(isVelocitySpike(4, [0, 0, 0, 0, 0])).toBe(false);
    expect(isVelocitySpike(5, [0, 0, 0, 0, 0])).toBe(true);
    expect(isVelocitySpike(7, [4, 4, 4, 4, 4])).toBe(false);
    expect(isVelocitySpike(9, [4, 4, 4, 4, 4])).toBe(true);
  });
});

describe("footprint planner warnings", () => {
  const site = (id: string, domain: string): FootprintSite => ({ id, workspaceId: `w-${id}`, domain, ipAddress: null, ipCClass: null, ownerFingerprint: null, maxOutboundPerMonth: 10, brandTerms: [] });
  const base: FootprintHistory = { reverseLinksRecent: 0, sameLinkActive: 0, pairDealsRecent: 0, giverLinksThisMonth: 0, anchorUsesForTarget: 0, linksToTarget: 5, keywordAnchorsToTarget: 2, receiverLinksThisMonth: 0, receiverPreviousMonths: [1, 1, 1, 1, 1] };
  const run = (anchor: string, h: Partial<FootprintHistory> = {}) => evaluateFootprint(site("g", "giver.com"), site("r", "acme.com"), anchor, { ...base, ...h }, { pairCooldownMonths: 6 }).warnings;

  it("warns when keyword anchors would pass half the profile", () => {
    expect(run("pricing software")).toEqual([]);
    expect(run("pricing software", { keywordAnchorsToTarget: 3 }).join(" ")).toMatch(/Keyword anchors would be 67%/);
    expect(run("acme", { keywordAnchorsToTarget: 3 })).toEqual([]); // branded anchor is fine
  });

  it("warns about a spike of links in one month", () => {
    expect(run("acme", { receiverLinksThisMonth: 3 })).toEqual([]);
    expect(run("acme", { receiverLinksThisMonth: 4 }).join(" ")).toMatch(/link 5 to acme.com this month/);
  });
});
