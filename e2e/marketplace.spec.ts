import { expect, test } from "@playwright/test";
import { approvedSite, balance, db, grantCredits, ledgerSum, newUser, resetDb, waitFor } from "./helpers";

test.beforeEach(resetDb);

test("sites: free limit of 2, admin review, auto-reject below minimum, starter credits once", async ({ browser }) => {
  const { page, ws } = await newUser(browser, "Admin", "admin@linkable.test", "SolGuruz SEO");
  for (const [domain, niche] of [["https://www.Low-DR.com/x", "Technology"], ["good-site.com", "Software & SaaS"]]) {
    await page.goto("/app/sites/new");
    await page.fill("input[name=domain]", domain);
    await page.selectOption("select[name=niche]", niche);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/app\/sites\/c/);
  }
  await expect(page.getByText("linkable-verify=")).toBeVisible();
  await page.goto("/app/sites/new");
  await page.fill("input[name=domain]", "third-site.com");
  await page.selectOption("select[name=niche]", "Travel");
  await page.click("button[type=submit]");
  await expect(page.getByText(/free plan allows 2 sites/)).toBeVisible();

  // Simulate proven ownership (live DNS isn't available in tests).
  await db.site.updateMany({ where: { workspaceId: ws.id }, data: { verifiedAt: new Date(), status: "PENDING_REVIEW", verificationMethod: "DNS_TXT" } });
  for (const s of await db.site.findMany({ where: { workspaceId: ws.id } })) await db.site.update({ where: { id: s.id }, data: { verifiedDomain: s.domain } });

  await page.goto("/admin/sites");
  const low = page.locator("section", { hasText: "low-dr.com" });
  await low.locator("input[name=domainRating]").fill("25");
  await low.locator("input[name=organicTraffic]").fill("3000");
  await low.getByRole("button", { name: "Save metrics" }).click();
  await expect(page.getByText("below the minimums and was rejected")).toBeVisible();

  const good = page.locator("section", { hasText: "good-site.com" });
  await good.locator("input[name=domainRating]").fill("45");
  await good.locator("input[name=organicTraffic]").fill("8000");
  await good.getByRole("button", { name: "Save metrics" }).click();
  await expect(page.getByText("Metrics saved for good-site.com")).toBeVisible();
  await page.locator("section", { hasText: "good-site.com" }).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("starter credits granted")).toBeVisible();
  expect(await balance(ws.id, "AVAILABLE")).toBe(2);
});

test("request -> offer -> escrow -> manual confirm; ABC swap with counter-offer", async ({ browser }) => {
  const X = await newUser(browser, "Sujit", "admin@linkable.test", "SolGuruz SEO");
  const Y = await newUser(browser, "Pat", "pat@partner.com", "Partner Media");
  await approvedSite(X.ws.id, "a-money.com", { dr: 50, give: false });
  await approvedSite(X.ws.id, "c-giver.com", { dr: 40, receive: false });
  const a2 = await approvedSite(X.ws.id, "a-two.com", { dr: 42, give: false });
  await approvedSite(Y.ws.id, "b-partner.com", { dr: 45 });
  await grantCredits(X.ws.id, 4);

  await X.page.goto("/app/requests/new");
  await X.page.fill("input[name=targetUrl]", "https://a-money.com/pricing");
  await X.page.fill("textarea[name=anchors]", "pricing tool");
  await X.page.uncheck("input[name=autoMatch]");
  await X.page.click("button[type=submit]:has-text('Post request')");
  await X.page.waitForURL(/\/app\/requests\/c/);
  const reqUrl = X.page.url();

  await Y.page.goto(reqUrl);
  await Y.page.getByRole("button", { name: "Send offer" }).click();
  await Y.page.waitForURL(/\/app\/proposals\/c/);
  await X.page.goto(Y.page.url());
  await X.page.getByRole("button", { name: "Accept and start the deal" }).click();
  await X.page.waitForURL(/\/app\/deals\/c/);
  expect(await balance(X.ws.id, "ESCROW")).toBe(2);

  await Y.page.goto(X.page.url());
  await Y.page.fill("input[name=sourcePageUrl]", "https://evil.com/post");
  await Y.page.getByRole("button", { name: "Mark as placed" }).click();
  await expect(Y.page.getByText("The page must be on b-partner.com")).toBeVisible();
  await Y.page.fill("input[name=sourcePageUrl]", "https://b-partner.com/blog/x");
  await Y.page.getByRole("button", { name: "Mark as placed" }).click();
  await expect(Y.page.getByText(/Marked as placed/)).toBeVisible();
  // The crawler can't reach b-partner.com/blog/x (404 from no server), so confirm manually.
  await X.page.reload();
  await X.page.getByRole("button", { name: "Confirm manually" }).click();
  await expect(X.page.getByText("Confirmed live. Thanks!")).toBeVisible();
  expect(await balance(Y.ws.id, "AVAILABLE")).toBe(1);

  // ABC swap: b-partner -> a-two, c-giver -> b-partner; counter flips the turn.
  // (b-partner -> a-money already exists, so the footprint guard would refuse it.)
  await X.page.goto("/app/marketplace");
  await X.page.getByRole("link", { name: /b-partner\.com/ }).click();
  await X.page.selectOption('select[name="legs.0.toSiteId"]', a2.id);
  await X.page.fill('input[name="legs.0.targetUrl"]', "https://a-two.com/features");
  await X.page.fill('input[name="legs.0.anchor"]', "feature list");
  await X.page.fill('input[name="legs.1.targetUrl"]', "https://b-partner.com/");
  await X.page.fill('input[name="legs.1.anchor"]', "partner media");
  await X.page.getByRole("button", { name: "Send proposal" }).click();
  await X.page.waitForURL(/\/app\/proposals\/c/);
  await Y.page.goto(X.page.url());
  await Y.page.fill('input[name="legs.1.anchor"]', "partner media tools");
  await Y.page.getByRole("button", { name: "Send counter-offer" }).click();
  await expect(Y.page.getByText("Counter-offer sent")).toBeVisible();
  await X.page.reload();
  await X.page.getByRole("button", { name: "Accept and start the deal" }).click();
  await X.page.waitForURL(/\/app\/deals\/c/);
  await X.page.getByRole("button", { name: "Cancel this deal" }).click();
  await expect(X.page.getByText("Deal cancelled.")).toBeVisible();
  expect(await ledgerSum()).toBe(0);
});

test("automatic matching respects the footprint guard", async ({ browser }) => {
  const X = await newUser(browser, "Sujit", "admin@linkable.test", "SolGuruz SEO");
  const Y = await newUser(browser, "Pat", "pat@partner.com", "Partner Media");
  const W = await newUser(browser, "Wes", "wes@samehost.com", "Same Host");
  await approvedSite(X.ws.id, "a-money.com", { dr: 50, ip: "93.184.216.10" });
  await approvedSite(Y.ws.id, "b-partner.com", { dr: 60 });
  await approvedSite(W.ws.id, "w-samehost.com", { dr: 70, ip: "93.184.216.20" });
  await grantCredits(X.ws.id, 6);

  await X.page.goto("/app/requests/new");
  await X.page.fill("input[name=targetUrl]", "https://a-money.com/pricing");
  await X.page.fill("textarea[name=anchors]", "pricing tool");
  await X.page.fill("input[name=maxCredits]", "4");
  await X.page.click("button[type=submit]:has-text('Post request')");
  await X.page.waitForURL(/\/app\/requests\/c/);
  await waitFor(() => db.match.count(), (n) => n >= 1, "match created");
  const matched = await db.match.findMany({ include: { site: true } });
  expect(matched.map((m) => m.site.domain)).toEqual(["b-partner.com"]); // same IP range blocked

  await Y.page.goto("/app/matches");
  await Y.page.getByRole("button", { name: "Accept and place the link" }).click();
  await Y.page.waitForURL(/\/app\/deals\/c/);
  expect(await balance(X.ws.id, "ESCROW")).toBe(4);
});

test("regression: rejecting a guest post then cancelling the deal refunds only once", async ({ browser }) => {
  const X = await newUser(browser, "Sujit", "admin@linkable.test", "SolGuruz SEO");
  const Y = await newUser(browser, "Pat", "pat@partner.com", "Partner Media");
  await approvedSite(X.ws.id, "a-money.com", { dr: 50 });
  await approvedSite(X.ws.id, "c-giver.com", { dr: 40 });
  const b = await approvedSite(Y.ws.id, "b-partner.com", { dr: 45 });
  await grantCredits(X.ws.id, 10);
  await db.platformSettings.update({ where: { id: "global" }, data: { guestPostMaxRevisions: 0 } });

  // Swap: leg 1 b -> a is a guest post X pays 3 for; leg 2 c -> b is an insertion.
  await X.page.goto(`/app/marketplace/${b.id}`);
  await X.page.fill('input[name="legs.0.targetUrl"]', "https://a-money.com/pricing");
  await X.page.fill('input[name="legs.0.anchor"]', "pricing tool");
  await X.page.selectOption('select[name="legs.0.placementType"]', "GUEST_POST");
  await X.page.fill('input[name="legs.0.credits"]', "3");
  await X.page.fill('input[name="legs.1.targetUrl"]', "https://b-partner.com/");
  await X.page.fill('input[name="legs.1.anchor"]', "partner media");
  await X.page.getByRole("button", { name: "Send proposal" }).click();
  await X.page.waitForURL(/\/app\/proposals\/c/);
  await Y.page.goto(X.page.url());
  await Y.page.getByRole("button", { name: "Accept and start the deal" }).click();
  await Y.page.waitForURL(/\/app\/deals\/c/);
  const dealUrl = Y.page.url();
  expect(await balance(X.ws.id, "ESCROW")).toBe(3);

  const words = Array.from({ length: 820 }, (_, i) => `word${i}`).join(" ");
  await X.page.goto(dealUrl);
  await X.page.fill("input[name=title]", "A practical guide to SaaS pricing");
  await X.page.fill("textarea[name=body]", `${words}\n\nUse a [pricing tool](https://a-money.com/pricing) to compare.`);
  await X.page.getByRole("button", { name: "Submit for review" }).click();
  await expect(X.page.getByText(/Waiting for Partner Media to review/)).toBeVisible();

  await Y.page.reload();
  await Y.page.selectOption("select[name=decision]", "reject");
  await Y.page.fill("textarea[name=note]", "Not a fit for our audience.");
  await Y.page.getByRole("button", { name: "Send decision" }).click();
  await expect(Y.page.getByText(/revision 1 · rejected/)).toBeVisible();
  expect(await balance(X.ws.id, "AVAILABLE")).toBe(10);

  await X.page.goto(dealUrl);
  await X.page.getByRole("button", { name: "Cancel this deal" }).click();
  await expect(X.page.getByText("Deal cancelled.")).toBeVisible();
  expect(await balance(X.ws.id, "AVAILABLE")).toBe(10); // not 13
  expect(await balance(X.ws.id, "ESCROW")).toBe(0);
  expect(await ledgerSum()).toBe(0);
});
