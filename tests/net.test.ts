import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gscOwnsDomain } from "@/lib/gsc";
import { safeGet } from "@/lib/net";

describe("safeGet SSRF guard", () => {
  let port = 0;
  const server = createServer((_, res) => res.end("secret"));
  beforeAll(() => new Promise<void>((r) => server.listen(0, "127.0.0.1", () => ((port = (server.address() as { port: number }).port), r()))));
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("refuses literal private IPs", async () => {
    await expect(safeGet(`http://127.0.0.1:${port}/`)).rejects.toThrow(/private/i);
  });

  it("refuses hostnames that resolve to private IPs", async () => {
    await expect(safeGet(`http://localhost:${port}/`)).rejects.toThrow();
  });

  it("refuses non-http schemes", async () => {
    await expect(safeGet("file:///etc/passwd")).rejects.toThrow(/scheme/);
  });
});

describe("gscOwnsDomain", () => {
  const fakeGoogle = (entries: { siteUrl: string; permissionLevel: string }[]) =>
    (async (url: string) => {
      if (url.includes("/token")) return new Response(JSON.stringify({ access_token: "at" }));
      if (url.includes("/webmasters/v3/sites")) return new Response(JSON.stringify({ siteEntry: entries }));
      return new Response("{}");
    }) as unknown as typeof fetch;

  it("accepts owners and full users only", async () => {
    expect(await gscOwnsDomain("code", "example.com", fakeGoogle([{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }]))).toBe(true);
    expect(await gscOwnsDomain("code", "example.com", fakeGoogle([{ siteUrl: "https://example.com/", permissionLevel: "siteFullUser" }]))).toBe(true);
    expect(await gscOwnsDomain("code", "example.com", fakeGoogle([{ siteUrl: "sc-domain:example.com", permissionLevel: "siteRestrictedUser" }]))).toBe(false);
    expect(await gscOwnsDomain("code", "example.com", fakeGoogle([{ siteUrl: "sc-domain:other.com", permissionLevel: "siteOwner" }]))).toBe(false);
  });
});
