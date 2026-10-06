import { describe, expect, it } from "vitest";
import { isPrivateIp } from "@/lib/ip";
import { isBannedNiche } from "@/lib/niches";
import { evaluateSite } from "@/lib/quality";
import { createAhrefsProvider } from "@/lib/seo/ahrefs";
import { analyseHomepage, metricSignals, spamScore } from "@/lib/spam";
import {
  dnsRecordValue,
  fileHasToken,
  gscPropertyMatches,
  htmlFileContent,
  htmlHasMetaToken,
  txtRecordsContain,
  verifyDnsTxt,
  verifyHtmlFile,
  verifyMetaTag,
} from "@/lib/verification";

const TOKEN = "tok_abc123XYZ";

describe("ownership matchers", () => {
  it("matches TXT records, including split strings", () => {
    expect(txtRecordsContain([["v=spf1 -all"], [dnsRecordValue(TOKEN)]], TOKEN)).toBe(true);
    expect(txtRecordsContain([["linkable-verify=", TOKEN]], TOKEN)).toBe(true);
    expect(txtRecordsContain([[dnsRecordValue("other")]], TOKEN)).toBe(false);
  });

  it("finds the meta tag in any attribute order and quoting", () => {
    expect(htmlHasMetaToken(`<head><meta name="linkable-site-verification" content="${TOKEN}"></head>`, TOKEN)).toBe(true);
    expect(htmlHasMetaToken(`<META content='${TOKEN}' NAME='linkable-site-verification' />`, TOKEN)).toBe(true);
    expect(htmlHasMetaToken(`<meta name="linkable-site-verification" content="${TOKEN}x">`, TOKEN)).toBe(false);
    expect(htmlHasMetaToken(`<!-- ${TOKEN} --><meta name="description" content="${TOKEN}">`, TOKEN)).toBe(false);
  });

  it("checks the HTML file body", () => {
    expect(fileHasToken(`\n${htmlFileContent(TOKEN)}\n`, TOKEN)).toBe(true);
    expect(fileHasToken(TOKEN, TOKEN)).toBe(false);
  });

  it("runs the checks with injected network functions", async () => {
    expect(await verifyDnsTxt("example.com", TOKEN, async () => [[dnsRecordValue(TOKEN)]])).toEqual({ ok: true });
    const failed = await verifyDnsTxt("example.com", TOKEN, async () => {
      throw new Error("ENOTFOUND");
    });
    expect(failed.ok).toBe(false);
    const page = (body: string, status = 200) => async () => ({ ok: status < 400, status, body });
    expect(await verifyMetaTag("example.com", TOKEN, page(`<meta name="linkable-site-verification" content="${TOKEN}">`))).toEqual({ ok: true });
    expect((await verifyMetaTag("example.com", TOKEN, page("", 500))).ok).toBe(false);
    expect(await verifyHtmlFile("example.com", TOKEN, page(htmlFileContent(TOKEN)))).toEqual({ ok: true });
    expect((await verifyHtmlFile("example.com", TOKEN, page("nope", 404))).ok).toBe(false);
  });

  it("matches Search Console properties safely", () => {
    expect(gscPropertyMatches("sc-domain:example.com", "example.com")).toBe(true);
    expect(gscPropertyMatches("sc-domain:example.com", "blog.example.com")).toBe(true);
    expect(gscPropertyMatches("sc-domain:blog.example.com", "example.com")).toBe(false);
    expect(gscPropertyMatches("sc-domain:notexample.com", "example.com")).toBe(false);
    expect(gscPropertyMatches("https://www.example.com/", "example.com")).toBe(true);
    expect(gscPropertyMatches("https://example.com/~user/", "example.com")).toBe(false);
  });
});

describe("isPrivateIp", () => {
  it("blocks internal ranges and allows public ones", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe("spam signals", () => {
  const words = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");

  it("is quiet for a normal homepage", () => {
    const html = `<html><body><p>${words}</p><a href="/about">About</a><a href="https://twitter.com/x">X</a></body></html>`;
    expect(spamScore(analyseHomepage(html, "example.com"))).toBe(0);
  });

  it("flags link selling, outbound-heavy and thin pages", () => {
    const links = Array.from({ length: 90 }, (_, i) => `<a href="https://site${i}.com/">s</a>`).join("");
    const signals = analyseHomepage(`<body>Write for us! ${links}</body>`, "example.com");
    const codes = signals.map((s) => s.code);
    expect(codes).toContain("many_outbound");
    expect(codes).toContain("sells_links");
    expect(codes).toContain("thin");
    expect(spamScore(signals)).toBe(70);
  });

  it("does not count own subdomains as outbound", () => {
    const links = Array.from({ length: 90 }, (_, i) => `<a href="https://s${i}.example.com/">s</a>`).join("");
    expect(analyseHomepage(`<p>${words}</p>${links}`, "example.com").map((s) => s.code)).not.toContain("many_outbound");
  });

  it("flags high DR with no traffic", () => {
    expect(metricSignals(60, 100)[0]?.code).toBe("dr_traffic_gap");
    expect(metricSignals(60, 20_000)).toEqual([]);
    expect(metricSignals(null, 100)).toEqual([]);
  });
});

describe("quality rules", () => {
  const rules = { minDomainRating: 30, minMonthlyTraffic: 500, bannedNiches: ["casino", "Finance"] };

  it("sends good sites to review", () => {
    expect(evaluateSite({ niche: "Technology", domainRating: 45, organicTraffic: 4000, spamScore: 0 }, rules)).toEqual({ decision: "review", reasons: [], warnings: [] });
  });

  it("auto-rejects below the minimums or in banned niches", () => {
    const r = evaluateSite({ niche: "finance", domainRating: 25, organicTraffic: 100, spamScore: 0 }, rules);
    expect(r.decision).toBe("reject");
    expect(r.reasons).toHaveLength(3);
    expect(isBannedNiche(" Casino ", rules.bannedNiches)).toBe(true);
  });

  it("asks for manual metrics and flags spam for review", () => {
    const r = evaluateSite({ niche: "Travel", domainRating: null, organicTraffic: null, spamScore: 55 }, rules);
    expect(r.decision).toBe("review");
    expect(r.warnings).toHaveLength(2);
  });
});

describe("ahrefs adapter", () => {
  it("calls both endpoints with the key and maps the response", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer KEY");
      const body = url.includes("domain-rating") ? { domain_rating: { domain_rating: 47.6 } } : { metrics: { org_traffic: 12345.4 } };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const metrics = await createAhrefsProvider("KEY", fake).getDomainMetrics("example.com");
    expect(metrics).toEqual({ domainRating: 48, organicTraffic: 12345 });
    expect(calls.some((u) => u.includes("/site-explorer/domain-rating?target=example.com"))).toBe(true);
    expect(calls.some((u) => u.includes("/site-explorer/metrics?target=example.com") && u.includes("mode=subdomains"))).toBe(true);
  });

  it("surfaces API errors", async () => {
    const fake = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    await expect(createAhrefsProvider("BAD", fake).getDomainMetrics("example.com")).rejects.toThrow(/HTTP 401/);
  });
});

describe("isPrivateIp: IPv6 forms that embed IPv4", () => {
  it("unwraps mapped, compatible and NAT64 addresses", () => {
    const hosts = ["[::ffff:127.0.0.1]", "[::ffff:a9fe:a9fe]", "[::ffff:7f00:1]", "::ffff:10.0.0.1", "[::127.0.0.1]", "64:ff9b::a9fe:a9fe", "[::]", "fe80::1%eth0", "2001:db8::1"];
    for (const h of hosts) expect(isPrivateIp(h), h).toBe(true);
    for (const h of ["::ffff:8.8.8.8", "[2606:4700:4700::1111]", "64:ff9b::808:808"]) expect(isPrivateIp(h), h).toBe(false);
    // what the URL parser actually produces for a mapped literal
    expect(isPrivateIp(new URL("http://[::ffff:127.0.0.1]/").hostname)).toBe(true);
    expect(isPrivateIp("not-an-ip")).toBe(true);
  });
});
