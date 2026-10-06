import { expect, test } from "@playwright/test";
import { approvedSite, balance, db, grantCredits, ledgerSum, newUser, partnerSite, resetDb, runDaily, waitFor } from "./helpers";

test.beforeEach(resetDb);

test("crawler verifies, link fails, grace period, removal penalty, dispute pauses releases", async ({ browser }) => {
  let mode: "ok" | "missing" = "ok";
  const page = (anchor: string, target: string) => () => ({ body: `<article>${"Text ".repeat(300)}${mode === "ok" ? `<a href="${target}">${anchor}</a>` : ""}</article>` });
  const server = await partnerSite({
    "/blog/one": page("pricing tool", "https://a-money.com/pricing"),
    "/blog/two": page("feature list", "https://a-money.com/features"),
  });
  try {
    const X = await newUser(browser, "Sujit", "admin@linkable.test", "SolGuruz SEO");
    const Y = await newUser(browser, "Pat", "pat@partner.com", "Partner Media");
    await approvedSite(X.ws.id, "a-money.com", { dr: 50 });
    await approvedSite(Y.ws.id, "b-partner.com", { dr: 45 });
    await grantCredits(X.ws.id, 10);

    async function deal(target: string, anchor: string) {
      await X.page.goto("/app/requests/new");
      await X.page.fill("input[name=targetUrl]", target);
      await X.page.fill("textarea[name=anchors]", anchor);
      await X.page.click("button[type=submit]:has-text('Post request')");
      await X.page.waitForURL(/\/app\/requests\/c/);
      await waitFor(() => db.match.count({ where: { status: "OFFERED" } }), (n) => n === 1, "match");
      await Y.page.goto("/app/matches");
      await Y.page.getByRole("button", { name: "Accept and place the link" }).click();
      await Y.page.waitForURL(/\/app\/deals\/c/);
      return { url: Y.page.url(), leg: await db.dealLeg.findFirstOrThrow({ where: { targetUrl: target } }) };
    }
    const legStatus = async (id: string) => (await db.dealLeg.findUniqueOrThrow({ where: { id } })).status;
    const age = (id: string, days: number) => db.dealLeg.update({ where: { id }, data: { lastCheckedAt: new Date(Date.now() - days * 86_400_000) } });

    // 1. placed -> verified by the crawler, first release paid
    const d1 = await deal("https://a-money.com/pricing", "pricing tool");
    await Y.page.fill("input[name=sourcePageUrl]", "https://b-partner.com/blog/one");
    await Y.page.getByRole("button", { name: "Mark as placed" }).click();
    await waitFor(() => legStatus(d1.leg.id), (s) => s === "VERIFIED", "verified");
    expect(await balance(Y.ws.id, "AVAILABLE")).toBe(1);

    // 2. missing twice -> FAILING; grace over -> REMOVED with penalty
    mode = "missing";
    await age(d1.leg.id, 8);
    await runDaily(X.page);
    await age(d1.leg.id, 8);
    await runDaily(X.page);
    expect(await legStatus(d1.leg.id)).toBe("FAILING");
    await db.dealLeg.update({ where: { id: d1.leg.id }, data: { failingSince: new Date(Date.now() - 8 * 86_400_000), lastCheckedAt: new Date(Date.now() - 2 * 86_400_000) } });
    await runDaily(X.page);
    expect(await legStatus(d1.leg.id)).toBe("REMOVED");
    expect(await balance(X.ws.id, "ESCROW")).toBe(0);
    expect(await balance(Y.ws.id, "AVAILABLE")).toBe(1 - 2); // penalty pushes into debt

    // 3. dispute holds a scheduled release; dismissal resumes it
    mode = "ok";
    const d2 = await deal("https://a-money.com/features", "feature list");
    await Y.page.fill("input[name=sourcePageUrl]", "https://b-partner.com/blog/two");
    await Y.page.getByRole("button", { name: "Mark as placed" }).click();
    await waitFor(() => legStatus(d2.leg.id), (s) => s === "VERIFIED", "verified 2");
    await X.page.goto(d2.url);
    await X.page.fill("textarea[name=reason]", "The article was behind a login for a few days.");
    await X.page.getByRole("button", { name: "Open a dispute" }).click();
    await expect(X.page.getByText(/Disputed by SolGuruz SEO/)).toBeVisible();
    await db.escrowRelease.updateMany({ where: { legId: d2.leg.id, releasedAt: null }, data: { releaseAt: new Date(Date.now() - 86_400_000) } });
    const before = await balance(Y.ws.id, "AVAILABLE");
    await runDaily(X.page);
    expect(await balance(Y.ws.id, "AVAILABLE")).toBe(before);

    await X.page.goto("/admin/disputes");
    await X.page.fill("textarea[name=note]", "Public again; no action.");
    await X.page.getByRole("button", { name: "Resolve" }).click();
    await expect(X.page.getByText("Dispute resolved.")).toBeVisible();
    await db.dealLeg.update({ where: { id: d2.leg.id }, data: { lastCheckedAt: new Date() } });
    await runDaily(X.page);
    expect(await balance(Y.ws.id, "AVAILABLE")).toBe(before + 1);
    expect(await ledgerSum()).toBe(0);
  } finally {
    server.close();
  }
});
