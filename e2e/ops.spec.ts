import { expect, test } from "@playwright/test";
import { approvedSite, mails, newUser, resetDb, runDaily } from "./helpers";

test.beforeEach(resetDb);

test("email digest, inbox, CSV exports with formula protection, admin analytics", async ({ browser }) => {
  const X = await newUser(browser, "Sujit", "admin@linkable.test", "SolGuruz SEO");
  const Y = await newUser(browser, "Pat", "pat@partner.com", "=HYPERLINK(\"http://evil\")");
  await approvedSite(X.ws.id, "a-money.com", { dr: 50 });
  await approvedSite(Y.ws.id, "b-partner.com", { dr: 45 });

  // Deal emails go to the daily digest instead of arriving one by one.
  await X.page.goto("/app/account");
  await X.page.selectOption("select[name=emailDeals]", "DIGEST");
  await X.page.getByRole("button", { name: "Save email settings" }).click();
  await expect(X.page.getByText("Email preferences saved")).toBeVisible();

  await X.page.goto("/app/requests/new");
  await X.page.fill("input[name=targetUrl]", "https://a-money.com/pricing");
  await X.page.fill("textarea[name=anchors]", "pricing tool");
  await X.page.uncheck("input[name=autoMatch]");
  await X.page.click("button[type=submit]:has-text('Post request')");
  await X.page.waitForURL(/\/app\/requests\/c/);
  await Y.page.goto(X.page.url());
  await Y.page.getByRole("button", { name: "Send offer" }).click();
  await Y.page.waitForURL(/\/app\/proposals\/c/);

  expect(mails().some((m) => m.to === "admin@linkable.test" && m.subject.startsWith("Offer for your link"))).toBe(false);
  const r = await runDaily(X.page);
  expect(r.digests).toBe(1);
  expect(mails().some((m) => m.to === "admin@linkable.test" && m.subject.startsWith("Your Linkable digest"))).toBe(true);

  await X.page.goto("/app/notifications");
  await expect(X.page.getByText(/Offer for your link to a-money.com/)).toBeVisible();
  await X.page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(X.page.getByText("0 unread")).toBeVisible();

  // Workspace export
  const ledger = await X.page.request.get("/api/export/links");
  expect(ledger.headers()["content-type"]).toContain("text/csv");
  expect(await ledger.text()).toContain("deal_id,direction,from_site");

  // Admin export neutralises a workspace name that is a spreadsheet formula.
  const wsCsv = await (await X.page.request.get("/api/admin/export/workspaces")).text();
  expect(wsCsv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  expect((await Y.page.request.get("/api/admin/export/users")).status()).toBe(403);

  await X.page.goto("/admin/analytics");
  await expect(X.page.getByText("Deals created per week")).toBeVisible();
  await expect(X.page.locator("tr", { hasText: "Net (must be 0)" })).toContainText("0");
});
