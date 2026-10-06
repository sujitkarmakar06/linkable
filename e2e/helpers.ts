import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { expect, type Browser, type Page } from "@playwright/test";
import { OUTBOX } from "../playwright.config";

const DB = process.env.E2E_DATABASE_URL ?? "postgresql://linkable:linkable@localhost:5432/linkable_e2e";
if (!/e2e|test/i.test(DB)) throw new Error(`Refusing to run e2e tests against ${DB}: the database name must contain "e2e" or "test".`);
export const db = new PrismaClient({ datasources: { db: { url: DB } } });

export const CRON = { authorization: "Bearer e2e-cron-secret" };
export const PASSWORD = "password-12345";

// Wipe everything except migrations, then restore default settings.
export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  writeFileSync(OUTBOX, "");
}

type Mail = { to: string; subject: string; link: string | null; items: number };
export function mails(): Mail[] {
  if (!existsSync(OUTBOX)) return [];
  return readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
export async function lastLink(to: string, subjectPart: string): Promise<string> {
  let found: string | null | undefined;
  await expect.poll(() => (found = mails().filter((m) => m.to === to && m.subject.includes(subjectPart)).at(-1)?.link)).toBeTruthy();
  return found!;
}

export async function signUp(page: Page, name: string, email: string, workspace?: string) {
  await page.goto("/signup");
  await page.fill("input[name=name]", name);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.check("input[name=terms]");
  await page.click("button[type=submit]");
  await expect(page.getByText("Check your inbox")).toBeVisible();
  await page.goto(await lastLink(email, "Verify"));
  await page.click("button[type=submit]");
  await page.waitForURL(/verified=1/);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/onboarding/);
  if (workspace) {
    await page.fill("input[name=name]", workspace);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/app$/);
  }
}

export async function newUser(browser: Browser, name: string, email: string, workspace: string) {
  const page = await (await browser.newContext()).newPage();
  await signUp(page, name, email, workspace);
  const ws = await db.workspace.findFirstOrThrow({ where: { name: workspace } });
  return { page, ws };
}

export async function approvedSite(workspaceId: string, domain: string, opts: { dr?: number; give?: boolean; receive?: boolean; niche?: string; ip?: string } = {}) {
  return db.site.create({
    data: {
      workspaceId,
      domain,
      niche: opts.niche ?? "Technology",
      canGive: opts.give ?? true,
      canReceive: opts.receive ?? true,
      verificationToken: `tok-${domain}`,
      verifiedAt: new Date(),
      verifiedDomain: domain,
      status: "APPROVED",
      domainRating: opts.dr ?? 45,
      organicTraffic: 5000,
      maxOutboundPerMonth: 10,
      ipAddress: opts.ip ?? null,
      ipCClass: opts.ip ? opts.ip.split(".").slice(0, 3).join(".") : null,
    },
  });
}

export async function grantCredits(workspaceId: string, amount: number) {
  const txId = `grant-${workspaceId}-${Date.now()}`;
  await db.creditEntry.createMany({
    data: [
      { txId, workspaceId: null, bucket: "PLATFORM", amount: -amount, reason: "SIGNUP_GRANT" },
      { txId, workspaceId, bucket: "AVAILABLE", amount, reason: "SIGNUP_GRANT" },
    ],
  });
}

export async function balance(workspaceId: string, bucket: "AVAILABLE" | "ESCROW") {
  return (await db.creditEntry.aggregate({ where: { workspaceId, bucket }, _sum: { amount: true } }))._sum.amount ?? 0;
}

export async function ledgerSum() {
  return (await db.creditEntry.aggregate({ _sum: { amount: true } }))._sum.amount ?? 0;
}

// Connect Search Console through the UI (GSC_FAKE stands in for Google).
export async function connectGsc(page: Page, siteId: string) {
  await page.goto(`/app/sites/${siteId}`);
  await page.getByRole("link", { name: "Connect Search Console" }).click();
  await expect(page.getByText("Search Console connected.")).toBeVisible();
}

export async function runDaily(page: Page) {
  const res = await page.request.get("/api/cron/daily", { headers: CRON });
  expect(res.status()).toBe(200);
  return res.json();
}

// A stand-in for partner websites (FETCH_HOST_OVERRIDES routes b-partner.com here).
export function partnerSite(routes: Record<string, () => { status?: number; body: string; type?: string }>): Promise<Server> {
  const server = createServer((req, res) => {
    const route = routes[req.url ?? ""];
    if (!route) return res.writeHead(404).end("not found");
    const r = route();
    res.writeHead(r.status ?? 200, { "content-type": r.type ?? "text/html" }).end(r.body);
  });
  return new Promise((resolve) => server.listen(4555, "127.0.0.1", () => resolve(server)));
}

export async function waitFor<T>(fn: () => Promise<T>, check: (v: T) => boolean, what = "condition") {
  await expect.poll(async () => check(await fn()), { message: what }).toBe(true);
}
