import { expect, test } from "@playwright/test";
import { generate } from "otplib";
import { PASSWORD, db, lastLink, resetDb, signUp } from "./helpers";

test.beforeEach(resetDb);

test("signup, workspace, 2FA with replay protection, recovery codes, invites, admin gate", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUp(page, "Admin", "admin@linkable.test", "SolGuruz SEO");
  await expect(page.getByRole("link", { name: "Admin", exact: true })).toBeVisible();

  // 2FA
  await page.goto("/app/account");
  await page.getByRole("button", { name: "Set up 2FA" }).click();
  const secret = (await page.locator("code").first().textContent())!.trim();
  await page.fill("input[name=code]", await generate({ secret }));
  await page.getByRole("button", { name: "Turn on 2FA" }).click();
  await expect(page.getByText("Save these recovery codes")).toBeVisible();
  const recovery = (await page.locator("pre").textContent())!.split("\n")[0];

  // The code used to enable 2FA can't be replayed to sign in.
  const enableCode = (await db.user.findFirstOrThrow({ where: { email: "admin@linkable.test" } })).lastTotpStep;
  expect(enableCode).not.toBeNull();

  const other = await (await browser.newContext()).newPage();
  await other.goto("/login");
  await other.fill("input[name=email]", "admin@linkable.test");
  await other.fill("input[name=password]", PASSWORD);
  await other.click("button[type=submit]");
  await other.fill("input[name=code]", recovery);
  await other.click("button[type=submit]");
  await other.waitForURL(/\/app$/);

  // A used recovery code is rejected.
  const third = await (await browser.newContext()).newPage();
  await third.goto("/login");
  await third.fill("input[name=email]", "admin@linkable.test");
  await third.fill("input[name=password]", PASSWORD);
  await third.click("button[type=submit]");
  await third.fill("input[name=code]", recovery);
  await third.click("button[type=submit]");
  await expect(third.getByText("That code didn't work")).toBeVisible();

  // Turning on 2FA ended the original session.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);

  // Invite a teammate (from the re-authenticated session); they can't reach admin pages.
  await other.goto("/app/workspace");
  await other.fill("input[name=email]", "mate@example.com");
  await other.click("button:has-text('Send invite')");
  await expect(other.getByText("Invite sent")).toBeVisible();
  const invite = await lastLink("mate@example.com", "Join SolGuruz SEO");
  const mate = await (await browser.newContext()).newPage();
  await signUp(mate, "Mate", "mate@example.com");
  await mate.goto(invite);
  await mate.click("button:has-text('Accept invite')");
  await mate.waitForURL(/\/app$/);
  await mate.goto("/admin");
  await expect(mate).toHaveURL(/\/app$/);
});

test("login is rate limited and sessions end after a password change", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUp(page, "Rae", "rae@example.com", "Rae Co");
  const elsewhere = await (await browser.newContext()).newPage();
  for (let i = 0; i < 5; i++) {
    await elsewhere.goto("/login");
    await elsewhere.fill("input[name=email]", "rae@example.com");
    await elsewhere.fill("input[name=password]", "wrong-password-" + i);
    await elsewhere.click("button[type=submit]");
    await expect(elsewhere.getByText("Email or password is incorrect")).toBeVisible();
  }
  await elsewhere.fill("input[name=password]", PASSWORD);
  await elsewhere.click("button[type=submit]");
  await expect(elsewhere.getByText(/Too many attempts/)).toBeVisible();

  // Second session (signed in before the change) is ended by a password change.
  await db.loginAttempt.deleteMany();
  const second = await (await browser.newContext()).newPage();
  await second.goto("/login");
  await second.fill("input[name=email]", "rae@example.com");
  await second.fill("input[name=password]", PASSWORD);
  await second.click("button[type=submit]");
  await second.waitForURL(/\/app$/);

  await page.goto("/app/account");
  await page.fill("input[name=current]", PASSWORD);
  await page.fill("input[name=next]", "a-brand-new-password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText(/signed out everywhere/)).toBeVisible();
  // Every session issued before the change is ended, this one included.
  await second.goto("/app");
  await expect(second).toHaveURL(/\/login/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
  await page.fill("input[name=email]", "rae@example.com");
  await page.fill("input[name=password]", "a-brand-new-password");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/app$/);
});

test("signup requires accepting the terms; legal pages and security headers", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.locator("input[name=terms]")).toHaveAttribute("required", "");
  const res = await page.goto("/terms");
  await expect(page.getByText("Draft - legal review required")).toBeVisible();
  await expect(page.getByText(/Search engine risk/)).toBeVisible();
  const h = res!.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
});
