import { describe, expect, it } from "vitest";
import { escapeHtml } from "@/lib/email";
import { categoryOf, emailModeFor } from "@/lib/notify-prefs";

const prefs = { emailDeals: "DIGEST", emailMessages: "OFF", emailSites: "INSTANT" } as const;

describe("email preferences", () => {
  it("routes kinds to categories", () => {
    expect(categoryOf("dispute.opened")).toBe("urgent");
    expect(categoryOf("leg.failing")).toBe("urgent");
    expect(categoryOf("leg.verified")).toBe("deals");
    expect(categoryOf("message.new")).toBe("messages");
    expect(categoryOf("site.approved")).toBe("sites");
  });
  it("always sends urgent emails instantly", () => {
    expect(emailModeFor("leg.removed", { ...prefs, emailDeals: "OFF" })).toBe("INSTANT");
    expect(emailModeFor("proposal.new", prefs)).toBe("DIGEST");
    expect(emailModeFor("message.new", prefs)).toBe("OFF");
    expect(emailModeFor("site.rejected", prefs)).toBe("INSTANT");
  });
  it("escapes user text in email HTML", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">&'`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;");
  });
});
