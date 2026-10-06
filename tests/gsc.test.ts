import { describe, expect, it } from "vitest";
import { GscAuthError, googleGsc, propertyForUrl } from "@/lib/gsc";

type Handler = (url: string, init?: RequestInit) => unknown;
const fakeGoogle = (handle: Handler) =>
  (async (url: string, init?: RequestInit) => {
    const out = handle(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out ?? {}));
  }) as unknown as typeof fetch;

describe("propertyForUrl", () => {
  it("prefers a domain property, including subdomains", () => {
    expect(propertyForUrl(["https://example.com/", "sc-domain:example.com"], "https://blog.example.com/a")).toBe("sc-domain:example.com");
  });
  it("uses the longest matching URL-prefix property", () => {
    const props = ["https://example.com/", "https://example.com/blog/"];
    expect(propertyForUrl(props, "https://example.com/blog/post")).toBe("https://example.com/blog/");
    expect(propertyForUrl(props, "https://example.com/about")).toBe("https://example.com/");
  });
  it("returns null when nothing covers the URL", () => {
    expect(propertyForUrl(["https://www.example.com/"], "https://example.com/a")).toBeNull();
    expect(propertyForUrl(["sc-domain:other.com"], "https://example.com/a")).toBeNull();
    expect(propertyForUrl(["sc-domain:example.com"], "not a url")).toBeNull();
  });
});

describe("googleGsc", () => {
  it("lists only properties the account owns or fully uses for the domain", async () => {
    const api = googleGsc(
      fakeGoogle((url) =>
        url.includes("/webmasters/v3/sites")
          ? {
              siteEntry: [
                { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
                { siteUrl: "https://example.com/", permissionLevel: "siteFullUser" },
                { siteUrl: "https://www.example.com/", permissionLevel: "siteRestrictedUser" },
                { siteUrl: "sc-domain:other.com", permissionLevel: "siteOwner" },
              ],
            }
          : {},
      ),
    );
    expect(await api.ownedProperties("at", "example.com")).toEqual(["sc-domain:example.com", "https://example.com/"]);
  });

  it("reads the refresh token and email from the code exchange", async () => {
    const idToken = `x.${Buffer.from(JSON.stringify({ email: "me@example.com" })).toString("base64url")}.y`;
    const api = googleGsc(fakeGoogle(() => ({ access_token: "at", refresh_token: "rt", id_token: idToken })));
    expect(await api.exchangeCode("code")).toEqual({ accessToken: "at", refreshToken: "rt", email: "me@example.com" });
  });

  it("turns invalid_grant into GscAuthError", async () => {
    const api = googleGsc(fakeGoogle(() => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));
    await expect(api.refresh("rt")).rejects.toBeInstanceOf(GscAuthError);
  });

  it("treats only a PASS verdict as indexed", async () => {
    let verdict = "PASS";
    const api = googleGsc(fakeGoogle(() => ({ inspectionResult: { indexStatusResult: { verdict, coverageState: "Submitted and indexed" } } })));
    expect(await api.inspect("at", "sc-domain:example.com", "https://example.com/a")).toEqual({ indexed: true, coverage: "Submitted and indexed" });
    verdict = "NEUTRAL";
    expect((await api.inspect("at", "sc-domain:example.com", "https://example.com/a")).indexed).toBe(false);
  });

  it("retries the other trailing-slash form when the page has no rows", async () => {
    const asked: string[] = [];
    const api = googleGsc(
      fakeGoogle((_, init) => {
        const expr = JSON.parse(String(init?.body)).dimensionFilterGroups[0].filters[0].expression as string;
        asked.push(expr);
        return expr.endsWith("/") ? { rows: [{ clicks: 3, impressions: 90, ctr: 0.033, position: 12.5 }] } : {};
      }),
    );
    expect(await api.totals("at", "sc-domain:example.com", "https://example.com/page", "2026-01-01", "2026-01-28")).toEqual({ clicks: 3, impressions: 90, ctr: 0.033, position: 12.5 });
    expect(asked).toEqual(["https://example.com/page", "https://example.com/page/"]);
  });

  it("reports zero with no position when Google has no data", async () => {
    const api = googleGsc(fakeGoogle(() => ({})));
    expect(await api.totals("at", "p", "https://example.com/", "2026-01-01", "2026-01-28")).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: null });
  });
});
