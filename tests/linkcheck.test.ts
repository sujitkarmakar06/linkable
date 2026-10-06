import { describe, expect, it } from "vitest";
import { analysePage, judge, nextLegState, samePage } from "@/lib/linkcheck";

const opts = { pageUrl: "https://giver.com/blog/post", targetUrl: "https://www.target.com/pricing/", anchor: "Pricing Tool" };

describe("analysePage", () => {
  it("finds the link, anchor and rel", () => {
    const a = analysePage(`<p>Try <a class="x" href="https://target.com/pricing?utm_source=x">pricing&nbsp;<b>tool</b></a></p>`, opts);
    expect(a).toMatchObject({ linkFound: true, anchorMatch: true, dofollow: true, noindex: false, canonicalElsewhere: false });
  });

  it("resolves relative links and prefers the agreed anchor", () => {
    const a = analysePage(`<a href="//target.com/pricing">here</a> <a href='https://target.com/pricing' rel="noopener">Pricing Tool</a>`, opts);
    expect(a.anchorText).toBe("Pricing Tool");
  });

  it("detects nofollow / sponsored / ugc", () => {
    expect(analysePage(`<a rel="nofollow noopener" href="https://target.com/pricing">Pricing Tool</a>`, opts).dofollow).toBe(false);
    expect(analysePage(`<a rel=sponsored href=https://target.com/pricing>Pricing Tool</a>`, opts).dofollow).toBe(false);
  });

  it("ignores links in comments and scripts, and other pages", () => {
    expect(analysePage(`<!-- <a href="https://target.com/pricing">x</a> --><script>"<a href='https://target.com/pricing'>x</a>"</script><a href="https://target.com/other">Pricing Tool</a>`, opts).linkFound).toBe(false);
  });

  it("detects noindex and a foreign canonical", () => {
    const a = analysePage(`<head><meta name="robots" content="noindex,follow"><link rel="canonical" href="https://other.com/x"></head><a href="https://target.com/pricing">Pricing Tool</a>`, opts);
    expect(a.noindex).toBe(true);
    expect(a.canonicalElsewhere).toBe(true);
    expect(analysePage("", { ...opts, xRobotsTag: "noindex" }).noindex).toBe(true);
  });

  it("compares pages ignoring www, slash, query and fragment", () => {
    expect(samePage("https://www.a.com/x/?q=1#f", "http://a.com/x")).toBe(true);
    expect(samePage("https://a.com/x", "https://a.com/y")).toBe(false);
  });
});

describe("judge", () => {
  const found = analysePage(`<a href="https://target.com/pricing">other words</a>`, opts);
  it("passes with an anchor warning", () => {
    expect(judge(200, found, "DOFOLLOW")).toEqual({ ok: true, problems: [], warnings: ['Anchor text is "other words" instead of the agreed anchor.'] });
  });
  it("fails on HTTP errors, missing links, nofollow and noindex", () => {
    expect(judge(404, found, "DOFOLLOW").ok).toBe(false);
    expect(judge(null, null, "DOFOLLOW", "timeout").problems[0]).toMatch(/timeout/);
    expect(judge(200, analysePage("<p>nothing</p>", opts), "DOFOLLOW").problems[0]).toMatch(/wasn't found/);
    const nf = analysePage(`<a rel="nofollow" href="https://target.com/pricing">Pricing Tool</a>`, opts);
    expect(judge(200, nf, "DOFOLLOW").ok).toBe(false);
    expect(judge(200, nf, "NOFOLLOW").ok).toBe(true);
  });
});

describe("nextLegState", () => {
  const rules = { failuresBeforeAlert: 2, graceDays: 7 };
  const now = new Date("2026-10-10T00:00:00Z");
  it("verifies placed links and nudges after repeated misses", () => {
    expect(nextLegState({ status: "PLACED", consecutiveFailures: 0, failingSince: null }, true, now, rules).event).toBe("verified");
    expect(nextLegState({ status: "PLACED", consecutiveFailures: 1, failingSince: null }, false, now, rules).event).toBe("not_found");
  });
  it("needs two failures before alerting, then a grace period before removal", () => {
    const one = nextLegState({ status: "VERIFIED", consecutiveFailures: 0, failingSince: null }, false, now, rules);
    expect(one).toMatchObject({ status: "VERIFIED", consecutiveFailures: 1, event: null });
    const two = nextLegState(one as never, false, now, rules);
    expect(two).toMatchObject({ status: "FAILING", event: "failing", failingSince: now });
    const sixDays = new Date(now.getTime() + 6 * 86_400_000);
    expect(nextLegState(two as never, false, sixDays, rules)).toMatchObject({ status: "FAILING", event: null });
    const eightDays = new Date(now.getTime() + 8 * 86_400_000);
    expect(nextLegState(two as never, false, eightDays, rules)).toMatchObject({ status: "REMOVED", event: "removed" });
    expect(nextLegState(two as never, true, sixDays, rules)).toMatchObject({ status: "VERIFIED", event: "restored", consecutiveFailures: 0 });
  });
});

describe("review fixes", () => {
  it("judges the agreed dofollow link over an earlier nofollow one", () => {
    const html = `<p>Bio: <a rel="nofollow" href="https://target.com/pricing">Target</a></p><p>Body <a href="https://target.com/pricing">pricing tools</a></p>`;
    const a = analysePage(html, { pageUrl: "https://giver.com/x", targetUrl: "https://target.com/pricing", anchor: "Pricing Tool" });
    expect(a.dofollow).toBe(true);
  });
});
