import { expect, test } from "@playwright/test";
import { approvedSite, balance, connectGsc, db, grantCredits, ledgerSum, newUser, partnerSite, resetDb, runDaily, waitFor } from "./helpers";

test.beforeEach(resetDb);

test("escrow waits for indexing, refunds if never indexed; impact before vs after", async ({ browser }) => {
  const article = (anchor: string, target: string) => () => ({ body: `<article>${"Text ".repeat(300)}<a href="${target}">${anchor}</a></article>` });
  const server = await partnerSite({
    "/blog/not-indexed-post": article("pricing tool", "https://a-money.com/pricing"),
    "/blog/indexed-post": article("feature list", "https://a-two.com/features"),
  });
  try {
    const X = await newUser(browser, "Sujit", "admin@linkable.test", "SolGuruz SEO");
    const Y = await newUser(browser, "Pat", "pat@partner.com", "Partner Media");
    await approvedSite(X.ws.id, "a-money.com", { dr: 50 });
    // A second receiving site: the footprint guard allows one link per site pair.
    const aTwo = await approvedSite(X.ws.id, "a-two.com", { dr: 48 });
    const bPartner = await approvedSite(Y.ws.id, "b-partner.com", { dr: 45 });
    await grantCredits(X.ws.id, 10);

    async function deal(target: string, anchor: string, page: string) {
      await X.page.goto("/app/requests/new");
      await X.page.selectOption("select[name=siteId]", (await db.site.findFirstOrThrow({ where: { domain: new URL(target).hostname } })).id);
      await X.page.fill("input[name=targetUrl]", target);
      await X.page.fill("textarea[name=anchors]", anchor);
      await X.page.click("button[type=submit]:has-text('Post request')");
      await X.page.waitForURL(/\/app\/requests\/c/);
      await waitFor(() => db.match.count({ where: { status: "OFFERED", linkRequest: { targetUrl: target } } }), (n) => n === 1, "match");
      await Y.page.goto("/app/matches");
      await Y.page.getByRole("button", { name: "Accept and place the link" }).click();
      await Y.page.waitForURL(/\/app\/deals\/c/);
      const url = Y.page.url();
      await Y.page.fill("input[name=sourcePageUrl]", `https://b-partner.com${page}`);
      await Y.page.getByRole("button", { name: "Mark as placed" }).click();
      const leg = await db.dealLeg.findFirstOrThrow({ where: { targetUrl: target } });
      await waitFor(async () => (await db.dealLeg.findUniqueOrThrow({ where: { id: leg.id } })).status, (s) => s === "VERIFIED", "verified");
      return { url, id: leg.id };
    }
    const legOf = (id: string) => db.dealLeg.findUniqueOrThrow({ where: { id } });

    // Host without Search Console: verified but waiting, nothing paid.
    const d1 = await deal("https://a-money.com/pricing", "pricing tool", "/blog/not-indexed-post");
    expect((await legOf(d1.id)).indexState).toBe("PENDING");
    await Y.page.goto(d1.url);
    await expect(Y.page.getByText(/hasn't connected Google Search Console/)).toBeVisible();
    await expect(Y.page.getByRole("link", { name: "Connect Search Console" })).toBeVisible();
    await runDaily(X.page);
    expect(await balance(Y.ws.id, "AVAILABLE")).toBe(0);

    // Connected, but Google says the page isn't indexed.
    await connectGsc(Y.page, bPartner.id);
    await expect(Y.page.getByText("sc-domain:b-partner.com")).toBeVisible();
    await db.dealLeg.update({ where: { id: d1.id }, data: { indexCheckedAt: null } });
    await runDaily(X.page);
    expect((await legOf(d1.id)).indexCoverage).toBe("Crawled - currently not indexed");
    expect(await balance(Y.ws.id, "AVAILABLE")).toBe(0);
    await X.page.goto(d1.url);
    await expect(X.page.getByText(/Crawled - currently not indexed/)).toBeVisible();

    // A week before the deadline the host is reminded once; at the deadline the receiver is refunded.
    await db.dealLeg.update({ where: { id: d1.id }, data: { indexDeadline: new Date(Date.now() + 3 * 86_400_000), lastCheckedAt: new Date() } });
    await runDaily(X.page);
    await runDaily(X.page);
    expect(await db.notification.count({ where: { kind: "leg.index_reminder" } })).toBe(1);
    await db.dealLeg.update({ where: { id: d1.id }, data: { indexDeadline: new Date(Date.now() - 60_000), lastCheckedAt: new Date() } });
    await runDaily(X.page);
    expect((await legOf(d1.id)).indexState).toBe("EXPIRED");
    expect(await balance(X.ws.id, "ESCROW")).toBe(0);
    expect(await balance(X.ws.id, "AVAILABLE")).toBe(10);
    expect(await balance(Y.ws.id, "AVAILABLE")).toBe(0);
    await X.page.goto(d1.url);
    await expect(X.page.getByText("Not indexed.")).toBeVisible();

    // An indexed page pays out at once.
    const d2 = await deal("https://a-two.com/features", "feature list", "/blog/indexed-post");
    await runDaily(X.page);
    expect((await legOf(d2.id)).indexState).toBe("INDEXED");
    expect(await balance(Y.ws.id, "AVAILABLE")).toBe(1);
    expect(await db.notification.count({ where: { kind: "leg.indexed" } })).toBeGreaterThan(0);

    // Impact: the receiver connects Search Console; 95 days later all four windows are in.
    await X.page.goto(d2.url);
    await expect(X.page.getByText(/to see this page's Google clicks/)).toBeVisible();
    await connectGsc(X.page, aTwo.id);
    await db.dealLeg.update({ where: { id: d2.id }, data: { verifiedAt: new Date(Date.now() - 95 * 86_400_000), lastCheckedAt: new Date() } });
    await runDaily(X.page);
    expect(await db.linkImpact.count({ where: { legId: d2.id } })).toBe(4);
    await X.page.goto(d2.url);
    await expect(X.page.getByText("90 days after")).toBeVisible();
    await X.page.goto("/app/impact");
    await expect(X.page.getByRole("link", { name: "b-partner.com → a-two.com" }).first()).toBeVisible();
    await expect(X.page.getByText(/at 90 days/).first()).toBeVisible();
    // The host doesn't see the receiver's Search Console numbers.
    await Y.page.goto(d2.url);
    await expect(Y.page.getByText("90 days after")).toHaveCount(0);

    // Disconnecting revokes access and removes the stored token.
    await Y.page.goto(`/app/sites/${bPartner.id}`);
    await Y.page.getByRole("button", { name: "Disconnect" }).click();
    await expect(Y.page.getByText("Search Console disconnected")).toBeVisible();
    expect(await db.gscConnection.count({ where: { siteId: bPartner.id } })).toBe(0);
    expect(await ledgerSum()).toBe(0);
  } finally {
    server.close();
  }
});
