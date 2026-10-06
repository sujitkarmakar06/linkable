import { describe, expect, it } from "vitest";
import { evaluateFootprint, isCdnIp, type FootprintHistory, type FootprintSite } from "@/lib/footprint";

const site = (id: string, extra: Partial<FootprintSite> = {}): FootprintSite => ({
  id, workspaceId: `ws-${id}`, domain: `${id}.com`, ipAddress: null, ipCClass: null, ownerFingerprint: null, maxOutboundPerMonth: 4, ...extra,
});
const clean: FootprintHistory = { reverseLinksRecent: 0, sameLinkActive: 0, pairDealsRecent: 0, giverLinksThisMonth: 0, anchorUsesForTarget: 0, linksToTarget: 10 };
const opts = { pairCooldownMonths: 6 };

describe("evaluateFootprint", () => {
  it("passes a clean link", () => {
    expect(evaluateFootprint(site("g"), site("r"), "seo tools", clean, opts)).toEqual({ blocks: [], warnings: [] });
  });

  it("blocks same owner, same IP and same C-class", () => {
    expect(evaluateFootprint(site("g", { ownerFingerprint: "x" }), site("r", { ownerFingerprint: "x" }), "a", clean, opts).blocks[0]).toMatch(/same owner/);
    expect(evaluateFootprint(site("g", { ipAddress: "203.0.113.5", ipCClass: "203.0.113" }), site("r", { ipAddress: "203.0.113.5", ipCClass: "203.0.113" }), "a", clean, opts).blocks[0]).toMatch(/same IP address/);
    expect(evaluateFootprint(site("g", { ipAddress: "203.0.113.5", ipCClass: "203.0.113" }), site("r", { ipAddress: "203.0.113.9", ipCClass: "203.0.113" }), "a", clean, opts).blocks[0]).toMatch(/same IP range/);
  });

  it("ignores shared CDN IPs", () => {
    const cf = { ipAddress: "104.21.3.4", ipCClass: "104.21.3" };
    expect(evaluateFootprint(site("g", cf), site("r", cf), "a", clean, opts).blocks).toEqual([]);
  });

  it("blocks cross-deal reciprocity, duplicates and the monthly cap", () => {
    const r = evaluateFootprint(site("g"), site("r"), "a", { ...clean, reverseLinksRecent: 1, sameLinkActive: 1, giverLinksThisMonth: 4 }, opts);
    expect(r.blocks).toHaveLength(3);
    expect(r.blocks.join(" ")).toMatch(/reciprocal/);
    expect(r.blocks.join(" ")).toMatch(/limit of 4 links/);
  });

  it("warns on repeat partners and anchor over-use", () => {
    const r = evaluateFootprint(site("g"), site("r"), "best seo", { ...clean, pairDealsRecent: 2, anchorUsesForTarget: 4, linksToTarget: 9 }, opts);
    expect(r.blocks).toEqual([]);
    expect(r.warnings[0]).toMatch(/traded 2 times/);
    expect(r.warnings[1]).toMatch(/50% of the anchors/);
    // Tiny samples don't trigger the anchor rule.
    expect(evaluateFootprint(site("g"), site("r"), "x", { ...clean, linksToTarget: 0 }, opts).warnings).toEqual([]);
  });
});

describe("isCdnIp", () => {
  it("knows common CDN ranges", () => {
    expect(isCdnIp("104.16.0.1")).toBe(true);
    expect(isCdnIp("172.67.1.1")).toBe(true);
    expect(isCdnIp("151.101.65.1")).toBe(true);
    expect(isCdnIp("93.184.216.34")).toBe(false);
    expect(isCdnIp("not-an-ip")).toBe(false);
  });
});
