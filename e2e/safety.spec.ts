import { expect, test } from "@playwright/test";
import { approvedSite, db, grantCredits, newUser, partnerSite, resetDb, waitFor } from "./helpers";

test.beforeEach(resetDb);

test("matches ranked by topic fit; link profile warnings and deal-time planner warnings", async ({ browser }) => {
  // The target page, served locally (every test host is routed here).
  const server = await partnerSite({
    "/pricing": () => ({
      body: `<html><head><title>Invoice software pricing for freelancers</title></head><body><main><h1>Invoice software pricing</h1>
        <p>Compare invoice software plans for freelancers: recurring invoices, time tracking, expense tracking and online payments. Invoice software for freelancers and small agencies.</p></main></body></html>`,
    }),
  });
  try {
    const X = await newUser(browser, "Sujit", "admin@linkable.test", "SolGuruz SEO");
    const Y = await newUser(browser, "Pat", "pat@partner.com", "Partner Media");
    const Z = await newUser(browser, "Zoe", "zoe@zeta.com", "Zeta Media");
    const W = await newUser(browser, "Wes", "wes@older.com", "Older Links");
    const aMoney = await approvedSite(X.ws.id, "a-money.com", { dr: 50 });
    const related = await approvedSite(Y.ws.id, "b-partner.com", { dr: 40 });
    const unrelated = await approvedSite(Z.ws.id, "c-giver.com", { dr: 55 });
    const older = await approvedSite(W.ws.id, "w-older.com", { dr: 45, give: false });
    await grantCredits(X.ws.id, 20);
    await db.site.update({ where: { id: related.id }, data: { topicsUpdatedAt: new Date(), topics: [{ t: "invoice", w: 1 }, { t: "freelancer", w: 0.8 }, { t: "invoice software", w: 0.7 }, { t: "billing", w: 0.5 }] } });
    await db.site.update({ where: { id: unrelated.id }, data: { topicsUpdatedAt: new Date(), topics: [{ t: "recipe", w: 1 }, { t: "vegan", w: 0.8 }, { t: "dessert", w: 0.5 }] } });

    // Existing links to a-money.com this month, all keyword anchors (from a site that only receives).
    const deal = await db.deal.create({ data: { source: "PROPOSAL", status: "LIVE" } });
    for (const anchor of ["invoice app", "invoice app", "invoice app", "billing tool", "billing tool"])
      await db.dealLeg.create({
        data: { dealId: deal.id, fromSiteId: older.id, toSiteId: aMoney.id, giverWorkspaceId: W.ws.id, receiverWorkspaceId: X.ws.id, targetUrl: "https://a-money.com/", anchor, status: "VERIFIED", verifiedAt: new Date(), indexState: "EXEMPT" },
      });

    // The planner on the site page.
    await X.page.goto(`/app/sites/${aMoney.id}`);
    await expect(X.page.getByText(/100% of anchors are keyword anchors/)).toBeVisible();
    await expect(X.page.getByText(/"invoice app" is 60% of anchors/)).toBeVisible();
    await expect(X.page.getByText(/5 links this month is well above the usual pace/)).toBeVisible();
    await expect(X.page.getByText(/Next, use a branded anchor/)).toBeVisible();

    // Brand names count as branded anchors.
    await X.page.fill("input[name=brandTerms]", "Billing Tool");
    await X.page.getByRole("button", { name: "Save" }).click();
    await expect(X.page.getByText("Saved.")).toBeVisible();
    await X.page.reload();
    await expect(X.page.getByText(/60% of anchors are keyword anchors/)).toBeVisible();

    // A request: the target page's topics are read, and offers are ranked by topic fit.
    await X.page.goto("/app/requests/new");
    await X.page.fill("input[name=targetUrl]", "https://a-money.com/pricing");
    await X.page.fill("textarea[name=anchors]", "invoice software");
    await X.page.click("button[type=submit]:has-text('Post request')");
    await X.page.waitForURL(/\/app\/requests\/c/);
    await waitFor(() => db.match.count({ where: { status: "OFFERED" } }), (n) => n === 2, "two matches");
    const matches = await db.match.findMany({ orderBy: { score: "desc" }, include: { site: true } });
    expect(matches[0].site.domain).toBe("b-partner.com"); // lower DR, but on topic
    expect(matches[0].relevance!).toBeGreaterThanOrEqual(70);
    expect(matches[1].relevance!).toBeLessThan(10);
    await X.page.reload();
    await expect(X.page.getByText(/Topics we read from it: .*invoice/)).toBeVisible();

    await Y.page.goto("/app/matches");
    await expect(Y.page.getByText("Topic fit:")).toBeVisible();
    await expect(Y.page.getByText("High")).toBeVisible();
    // Deal-time planner warnings travel with the offer.
    await expect(Y.page.getByText(/Keyword anchors would be/)).toBeVisible();
    await expect(Y.page.getByText(/This would be link 6 to a-money.com this month/)).toBeVisible();
  } finally {
    server.close();
  }
});
