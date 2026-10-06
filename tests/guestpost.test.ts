import { describe, expect, it } from "vitest";
import { contentHash, countWords, extractLinks, splitTitle, validateGuestPost } from "@/lib/guestpost";
import { parseSitemap, summarisePage } from "@/lib/pagetext";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const base = { title: "How to price a SaaS product", targetUrl: "https://a-money.com/pricing", anchor: "pricing tool", receiverDomain: "a-money.com", minWords: 800 };

describe("validateGuestPost", () => {
  it("accepts a post with exactly one correct link", () => {
    expect(validateGuestPost({ ...base, body: `${words(820)}\n\nTry this [Pricing Tool](https://www.a-money.com/pricing/) today. See also [docs](https://other.org).` })).toEqual([]);
  });

  it("enforces length, title and the single agreed link", () => {
    const errors = validateGuestPost({ ...base, title: "Short", body: `${words(100)} [x](https://a-money.com/) [pricing tool](https://a-money.com/pricing)` });
    expect(errors.join(" | ")).toMatch(/title should be/);
    expect(errors.join(" | ")).toMatch(/103 words; the minimum is 800/);
    expect(errors.join(" | ")).toMatch(/Only one link/);
    expect(validateGuestPost({ ...base, body: words(900) })[0]).toMatch(/Include the agreed link/);
    expect(validateGuestPost({ ...base, body: `${words(900)} [cheap pricing](https://a-money.com/pricing)` })[0]).toMatch(/must be the agreed anchor/);
    expect(validateGuestPost({ ...base, body: `${words(900)} [pricing tool](https://blog.a-money.com/x)` })[0]).toMatch(/must point to/);
  });
});

describe("helpers", () => {
  it("extracts markdown and HTML links", () => {
    expect(extractLinks('[a](https://x.com "t") and <a href="https://y.com"><b>b</b></a>')).toEqual([
      { text: "a", url: "https://x.com" },
      { text: "b", url: "https://y.com" },
    ]);
  });
  it("counts words without markup", () => {
    expect(countWords("# Title\n\nSome **bold** [link text](https://x.com) - here.\n\n```\ncode block ignored\n```")).toBe(6);
  });
  it("ignores whitespace/case in content hashes", () => {
    expect(contentHash("Hello   World\n")).toBe(contentHash("hello world"));
    expect(contentHash("hello world!")).not.toBe(contentHash("hello world"));
  });
  it("splits a leading markdown title", () => {
    expect(splitTitle("# My Title\n\nBody here")).toEqual({ title: "My Title", body: "Body here" });
    expect(splitTitle("No title")).toEqual({ title: "", body: "No title" });
  });
  it("summarises pages and parses sitemaps", () => {
    const s = summarisePage('<title>Pricing &amp; Plans</title><meta name="description" content="Plans for teams"><nav>menu</nav><main><h1>Pricing</h1><p>Simple plans.</p></main>');
    expect(s).toMatchObject({ title: "Pricing & Plans", description: "Plans for teams", h1: "Pricing" });
    expect(s.text).toContain("Simple plans.");
    expect(s.text).not.toContain("menu");
    expect(parseSitemap("<urlset><url><loc>https://a.com/x</loc></url></urlset>")).toEqual({ urls: ["https://a.com/x"], sitemaps: [] });
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>").sitemaps).toEqual(["https://a.com/s1.xml"]);
  });
});

describe("guest-post safety", () => {
  const words900 = Array.from({ length: 900 }, (_, i) => `w${i}`).join(" ");
  const ok = { title: "How to price a SaaS product", targetUrl: "https://a-money.com/pricing", anchor: "pricing tool", receiverDomain: "a-money.com", minWords: 800 };
  it("rejects raw HTML and non-http links", () => {
    const link = "[pricing tool](https://a-money.com/pricing)";
    expect(validateGuestPost({ ...ok, body: `${words900} ${link} <img src=x onerror=alert(1)>` }).join(" ")).toMatch(/Raw HTML/);
    expect(validateGuestPost({ ...ok, body: `${words900} ${link} [click](javascript:alert(1))` }).join(" ")).toMatch(/http:\/\/ or https:\/\//);
  });
});
