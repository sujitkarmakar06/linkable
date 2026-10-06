import { defineConfig } from "@playwright/test";

// End-to-end tests run against `next dev` (so the dev-only test hooks work:
// AI_FAKE, FETCH_HOST_OVERRIDES, EMAIL_OUTBOX_FILE) and a dedicated database.
// E2E_DATABASE_URL must point at a throwaway database: every test wipes it.
const PORT = 3100;
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://linkable:linkable@localhost:5432/linkable_e2e";
export const OUTBOX = `${process.cwd()}/e2e/.outbox.jsonl`;

export default defineConfig({
  testDir: "e2e",
  workers: 1, // one shared database
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    actionTimeout: 60_000,
    navigationTimeout: 90_000,
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: DB,
      DIRECT_URL: DB,
      APP_URL: `http://localhost:${PORT}`,
      AUTH_URL: `http://localhost:${PORT}`,
      AUTH_TRUST_HOST: "true",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-e2e",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "0".repeat(64),
      CRON_SECRET: "e2e-cron-secret",
      AI_FAKE: "1",
      EMAIL_OUTBOX_FILE: OUTBOX,
      FETCH_HOST_OVERRIDES: "b-partner.com=127.0.0.1:4555",
      PLATFORM_ADMIN_EMAILS: "admin@linkable.test",
      RESEND_API_KEY: "",
    },
  },
});
