import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
