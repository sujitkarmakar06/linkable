import { describe, expect, it, beforeAll } from "vitest";
import { normalizeDomain, slugify } from "@/lib/domain";
import { canAssignRole, hasRole } from "@/lib/roles";

describe("normalizeDomain", () => {
  it("strips scheme, www, path and case", () => {
    expect(normalizeDomain("https://www.Example.com/blog?x=1")).toBe("example.com");
    expect(normalizeDomain("blog.example.co.uk")).toBe("blog.example.co.uk");
  });
  it("rejects junk", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("not a domain")).toBeNull();
  });
});

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("Acme Marketing, Inc.")).toBe("acme-marketing-inc");
    expect(slugify("!!!")).toBe("workspace");
  });
});

describe("roles", () => {
  it("ranks roles", () => {
    expect(hasRole("OWNER", "ADMIN")).toBe(true);
    expect(hasRole("MEMBER", "ADMIN")).toBe(false);
  });
  it("only owners can grant admin or owner", () => {
    expect(canAssignRole("OWNER", "ADMIN")).toBe(true);
    expect(canAssignRole("ADMIN", "ADMIN")).toBe(false);
    expect(canAssignRole("ADMIN", "MEMBER")).toBe(true);
    expect(canAssignRole("MEMBER", "VIEWER")).toBe(false);
  });
});

describe("crypto + totp", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "a".repeat(64);
  });

  it("round-trips encrypted secrets and detects tampering", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const box = encrypt("JBSWY3DPEHPK3PXP");
    expect(box).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decrypt(box)).toBe("JBSWY3DPEHPK3PXP");
    const [iv, tag, data] = box.split(".");
    expect(() => decrypt([iv, tag, data.slice(0, -2) + (data.endsWith("A") ? "BB" : "AA")].join("."))).toThrow();
  });

  it("verifies current TOTP codes and rejects wrong ones", async () => {
    const { generate } = await import("otplib");
    const { generateSecret, verifyTotp, generateRecoveryCodes } = await import("@/lib/totp");
    const secret = generateSecret();
    const token = await generate({ secret });
    const ok = await verifyTotp(secret, token);
    expect(ok.valid).toBe(true);
    expect((await verifyTotp(secret, token === "000000" ? "111111" : "000000")).valid).toBe(false);
    expect((await verifyTotp(secret, "abc")).valid).toBe(false);
    // replay protection: the same step can't be used again
    expect((await verifyTotp(secret, token, ok.timeStep)).valid).toBe(false);
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(8);
    expect(codes[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
  });
});
