import { expect, test } from "@playwright/test";
import { approvedSite, db, grantCredits, ledgerSum, newUser, partnerSite, resetDb, waitFor } from "./helpers";

test.beforeEach(resetDb);

test("guest post with an AI draft: edit required, review, publish, verify; placement finder and AI cap", async ({ browser }) => {
  let anchor = "";
  const server = await partnerSite({
    "/sitemap.xml": () => ({ type: "application/xml", body: `<urlset>${["/blog/saas-pricing-basics", "/blog/team-productivity"].map((p) => `<url><loc>https://b-partner.com${p}</loc></url>`).join("")}</urlset>` }),
    "/blog/guest-post": () => ({ body: `<article>${"Text ".repeat(300)}<a href="https://a-money.com/pricing">${anchor}</a></article>` }),
  });
  try {
    const X = await newUser(browser, "Sujit", "admin@linkable.test", "SolGuruz SEO");
    const Y = await newUser(browser, "Pat", "pat@partner.com", "Partner Media");
    const a = await approvedSite(X.ws.id, "a-money.com", { dr: 50 });
    const a2 = await approvedSite(X.ws.id, "a-second.com", { dr: 40 });
    await approvedSite(Y.ws.id, "b-partner.com", { dr: 45 });
    await grantCredits(X.ws.id, 10);

    await X.page.goto("/app/requests/new");
    await X.page.selectOption("select[name=siteId]", a.id);
    await X.page.fill("input[name=targetUrl]", "https://a-money.com/pricing");
    await X.page.getByRole("button", { name: "Suggest anchors with AI" }).click();
    await X.page.getByRole("button", { name: /\+ pricing tool/ }).click();
    await expect(X.page.locator("textarea[name=anchors]")).toHaveValue("pricing tool");
    await X.page.selectOption("select[name=placementType]", "GUEST_POST");
    await X.page.fill("input[name=maxCredits]", "3");
    await X.page.click("button[type=submit]:has-text('Post request')");
    await X.page.waitForURL(/\/app\/requests\/c/);
    await waitFor(() => db.match.count(), (n) => n === 1, "match");
    await Y.page.goto("/app/matches");
    await Y.page.getByRole("button", { name: "Accept and place the link" }).click();
    await Y.page.waitForURL(/\/app\/deals\/c/);
    const url = Y.page.url();
    const leg = await db.dealLeg.findFirstOrThrow();
    anchor = leg.anchor;
    await expect(Y.page.locator("input[name=sourcePageUrl]")).toHaveCount(0); // can't publish before approval

    await X.page.goto(url);
    await X.page.getByRole("button", { name: "Write a draft with AI" }).click();
    await expect(X.page.getByText("Draft added below")).toBeVisible();
    await X.page.getByRole("button", { name: "Submit for review" }).click();
    await expect(X.page.getByText(/unedited AI draft/)).toBeVisible();
    const body = (await X.page.inputValue("textarea[name=body]")).replace(/\s*\[VERIFY:[^\]]*\]/g, " We see this with our own customers.");
    await X.page.fill("textarea[name=body]", body + "\n\n<script>alert(1)</script>");
    await X.page.getByRole("button", { name: "Submit for review" }).click();
    await expect(X.page.getByText(/Raw HTML isn't allowed/)).toBeVisible();
    await X.page.fill("textarea[name=body]", body);
    await X.page.getByRole("button", { name: "Submit for review" }).click();
    await expect(X.page.getByText(/Waiting for Partner Media to review/)).toBeVisible();

    await Y.page.reload();
    await expect(Y.page.getByText("AI-assisted").first()).toBeVisible();
    await Y.page.getByRole("button", { name: "Send decision" }).click();
    await expect(Y.page.getByLabel("HTML")).toBeVisible();
    await Y.page.fill("input[name=sourcePageUrl]", "https://b-partner.com/blog/guest-post");
    await Y.page.getByRole("button", { name: "Mark as placed" }).click();
    await waitFor(async () => (await db.dealLeg.findUniqueOrThrow({ where: { id: leg.id } })).status, (s) => s === "VERIFIED", "guest post verified");

    // Insertion deal to a second site -> placement finder, with the monthly cap.
    await X.page.goto("/app/requests/new");
    await X.page.selectOption("select[name=siteId]", a2.id);
    await X.page.fill("input[name=targetUrl]", "https://a-second.com/features");
    await X.page.fill("textarea[name=anchors]", "feature overview");
    await X.page.click("button[type=submit]:has-text('Post request')");
    await X.page.waitForURL(/\/app\/requests\/c/);
    await waitFor(() => db.match.count({ where: { status: "OFFERED" } }), (n) => n === 1, "match 2");
    await Y.page.goto("/app/matches");
    await Y.page.getByRole("button", { name: "Accept and place the link" }).click();
    await Y.page.waitForURL(/\/app\/deals\/c/);
    await db.platformSettings.update({ where: { id: "global" }, data: { aiSuggestionsPerMonth: 0 } });
    await Y.page.getByRole("button", { name: /Find the best page/ }).click();
    await expect(Y.page.getByText(/used all 0 AI suggestions/)).toBeVisible();
    await db.platformSettings.update({ where: { id: "global" }, data: { aiSuggestionsPerMonth: 20 } });
    await Y.page.getByRole("button", { name: /Find the best page/ }).click();
    await expect(Y.page.getByText("https://b-partner.com/blog/saas-pricing-basics")).toBeVisible();
    expect(await ledgerSum()).toBe(0);
  } finally {
    server.close();
  }
});
